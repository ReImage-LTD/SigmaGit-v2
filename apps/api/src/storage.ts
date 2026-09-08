import { setTimeout as delay } from 'node:timers/promises';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCopyCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectTaggingCommand,
} from '@aws-sdk/client-s3';
import { readdir, readFile, writeFile, unlink, mkdir, stat, rm } from 'node:fs/promises';
import { MAX_LOCAL_LIST_KEYS } from './middleware/limits';
import { join, dirname, resolve, sep } from 'node:path';
import { requestSignal } from './lib/request-context';
import { boundedStream } from './lib/bounded-stream';
import { config } from './config';
import { atomicWriteFile } from './lib/atomic-file';
import { createObjectReadCache } from './lib/object-read-cache';
import { createHash } from 'node:crypto';

function isThrottleLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = maybe.$metadata?.httpStatusCode;
  return (
    maybe.name === 'SlowDown' || maybe.name === 'Throttling' || status === 429 || status === 503
  );
}

export async function runAdaptiveBatch<T>(
  items: T[],
  initialConcurrency: number,
  minConcurrency: number,
  maxConcurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const maximum = Math.max(1, Math.min(64, maxConcurrency));
  const minimum = Math.max(1, Math.min(maximum, minConcurrency));
  let concurrency = Math.max(minimum, Math.min(maximum, initialConcurrency));
  const pending = items.map(item => ({ item, attempts: 0 }));
  while (pending.length) {
    requestSignal()?.throwIfAborted();
    const batch = pending.splice(0, concurrency);
    const results = await Promise.allSettled(batch.map(({ item }) => task(item)));
    let retryAttempt = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') continue;
      const entry = batch[i];
      if (!isThrottleLikeError(result.reason) || entry.attempts >= 4) throw result.reason;
      entry.attempts++;
      retryAttempt = Math.max(retryAttempt, entry.attempts);
      pending.push(entry);
    }
    if (retryAttempt) {
      concurrency = Math.max(minimum, Math.floor(concurrency / 2));
      await delay(25 * 2 ** (retryAttempt - 1) + Math.random() * 25, undefined,
        { signal: requestSignal() });
    } else {
      concurrency = Math.min(maximum, concurrency + 1);
    }
  }
}

/** Directory operations must never select sibling keys or the bucket root. */
export function directoryPrefix(prefix: string): string {
  const path = prefix.replace(/\/+$/, '');
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid storage directory prefix');
  }
  return path + '/';
}

export type StorageType = 's3' | 'local';

export interface StoredObject {
  data: Buffer;
  etag?: string;
}

export interface DirectoryPageOptions {
  limit: number;
  cursor?: string;
  startAfter?: string;
}

export interface DirectoryPage {
  entries: string[];
  nextCursor: string | null;
}

export interface StorageBackend {
  type: StorageType;
  get(key: string): Promise<Buffer | null>;
  getWithMetadata(key: string): Promise<StoredObject | null>;
  copyObject(key: string, targetKey: string, size: number, etag?: string): Promise<void>;
  put(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSize(key: string): Promise<number | null>;
  list(prefix: string): Promise<string[]>;
  listDirectory(prefix: string): Promise<string[]>;
  listDirectoryPage(prefix: string, options: DirectoryPageOptions): Promise<DirectoryPage>;
  hasPrefix(prefix: string): Promise<boolean>;
  deletePrefix(prefix: string): Promise<void>;
  copyPrefix(sourcePrefix: string, targetPrefix: string): Promise<void>;
  getStream(key: string, signal?: AbortSignal): Promise<ReadableStream | null>;
}

export class S3StorageBackend implements StorageBackend {
  type: StorageType = 's3';
  private client: S3Client | null = null;
  private bucket: string;

  constructor(s3 = config.storage.s3) {
    this.bucket = s3.bucket;

    if (s3.endpoint && s3.region && s3.accessKeyId && s3.secretAccessKey) {
      this.client = new S3Client({
        endpoint: s3.endpoint,
        region: s3.region,
        credentials: {
          accessKeyId: s3.accessKeyId,
          secretAccessKey: s3.secretAccessKey,
        },
        forcePathStyle: true,
      });
    }
  }

  async get(key: string): Promise<Buffer | null> {
    return (await this.getWithMetadata(key))?.data ?? null;
  }

  async getWithMetadata(key: string): Promise<StoredObject | null> {
    if (!this.client) {
      throw new Error('S3 is not configured');
    }

    try {
      const signal = requestSignal(AbortSignal.timeout(30_000));
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: signal },
      );
      if (!response.Body) {
        return null;
      }

      const bytes = await new Response(
        boundedStream(
          response.Body.transformToWebStream(),
          Infinity,
          () => new Error('Storage response too large'),
          signal,
        ),
      ).arrayBuffer();
      return { data: Buffer.from(bytes), etag: response.ETag };
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async put(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void> {
    if (!this.client) {
      throw new Error('S3 is not configured');
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
      { abortSignal: requestSignal() },
    );
  }

  async delete(key: string): Promise<void> {
    if (!this.client) {
      throw new Error('S3 is not configured');
    }

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { abortSignal: requestSignal() },
    );
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
        { abortSignal: requestSignal() },
      );
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async getSize(key: string): Promise<number | null> {
    if (!this.client) {
      return null;
    }

    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
        { abortSignal: requestSignal() },
      );
      return response.ContentLength ?? null;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    if (!this.client) {
      return [];
    }

    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: requestSignal() },
      );

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) {
            keys.push(obj.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  async hasPrefix(prefix: string): Promise<boolean> {
    if (!this.client) throw new Error('S3 is not configured');
    const response = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket, Prefix: directoryPrefix(prefix), MaxKeys: 1,
    }), {abortSignal: requestSignal()});
    return Boolean(response.Contents?.length);
  }

  async listDirectory(prefix: string): Promise<string[]> {
    if (!this.client) throw new Error('S3 is not configured');
    prefix = directoryPrefix(prefix);
    const entries = new Set<string>();
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: continuationToken,
      }), {abortSignal: requestSignal()});
      for (const key of [
        ...(response.Contents ?? []).map(object => object.Key),
        ...(response.CommonPrefixes ?? []).map(object => object.Prefix),
      ]) {
        const name = key?.slice(prefix.length).replace(/\/$/, '');
        if (name) entries.add(name);
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    return [...entries].sort();
  }

  async listDirectoryPage(prefix: string, options: DirectoryPageOptions): Promise<DirectoryPage> {
    if (!this.client) throw new Error('S3 is not configured');
    prefix = directoryPrefix(prefix);
    const result = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket, Prefix: prefix, Delimiter: '/',
      MaxKeys: Math.max(1, Math.min(1000, options.limit)),
      ContinuationToken: options.cursor,
      StartAfter: !options.cursor && options.startAfter ? prefix + options.startAfter + '/' : undefined,
    }), { abortSignal: requestSignal() });
    const entries = new Set<string>();
    for (const key of [
      ...(result.Contents ?? []).map(entry => entry.Key),
      ...(result.CommonPrefixes ?? []).map(entry => entry.Prefix),
    ]) {
      const name = key?.slice(prefix.length).replace(/\/$/, '');
      if (name) entries.add(name);
    }
    return { entries: [...entries].sort((a, b) => a + '/' < b + '/' ? -1 : a === b ? 0 : 1), nextCursor: result.NextContinuationToken ?? null };
  }

  async deletePrefix(prefix: string): Promise<void> {
    prefix = directoryPrefix(prefix);
    if (!this.client) throw new Error('S3 is not configured');
    const client = this.client;
    let continuationToken: string | undefined;
    do {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken, MaxKeys: 1000,
      }), {abortSignal: requestSignal()});
      let pending = response.Contents?.flatMap(object => object.Key ? [{Key: object.Key}] : []) ?? [];
      if (pending.length) {
        await runAdaptiveBatch([0], 1, 1, 1, async () => {
          const result = await client.send(new DeleteObjectsCommand({
            Bucket: this.bucket, Delete: {Objects: pending, Quiet: true},
          }), {abortSignal: requestSignal()});
          const errors = result.Errors ?? [];
          if (!errors.length) return;
          const permanent = errors.find(error => !isThrottleLikeError({name: error.Code}));
          if (permanent) throw new Error('S3 bulk delete failed: ' + permanent.Code);
          const failed = new Set(errors.map(error => error.Key));
          pending = pending.filter(object => failed.has(object.Key));
          if (!pending.length) throw new Error('S3 returned an invalid delete failure response');
          throw Object.assign(new Error('S3 bulk delete throttled'), {name: 'SlowDown'});
        });
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
  }

  async copyObject(key: string, targetKey: string, size: number, etag?: string): Promise<void> {
    if (!this.client) throw new Error('S3 is not configured');
    const client = this.client;
    const CopySource = encodeURIComponent(this.bucket + '/' + key);
    const options = { abortSignal: requestSignal() };
    if (size <= 5 * 1024 ** 3) {
      await client.send(new CopyObjectCommand({
        Bucket: this.bucket, Key: targetKey, CopySource, CopySourceIfMatch: etag,
        MetadataDirective: 'COPY', TaggingDirective: 'COPY',
      }), options);
      return;
    }
    const [head, tags] = await Promise.all([
      client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: etag }), options),
      client.send(new GetObjectTaggingCommand({ Bucket: this.bucket, Key: key }), options),
    ]);
    const upload = await client.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket, Key: targetKey, ContentType: head.ContentType,
      ContentEncoding: head.ContentEncoding, ContentLanguage: head.ContentLanguage,
      ContentDisposition: head.ContentDisposition, CacheControl: head.CacheControl,
      Expires: head.Expires, Metadata: head.Metadata,
      Tagging: new URLSearchParams((tags.TagSet ?? []).map<[string, string]>(tag => [tag.Key!, tag.Value!])).toString() || undefined,
    }), options);
    if (!upload.UploadId) throw new Error('Missing multipart upload ID');
    const UploadId = upload.UploadId;
    try {
      const partSize = Math.max(128 * 1024 ** 2, Math.ceil(size / 10000 / 1024 ** 2) * 1024 ** 2);
      const partNumbers = Array.from({ length: Math.ceil(size / partSize) }, (_, i) => i + 1);
      const parts: Array<{ PartNumber: number; ETag: string }> = [];
      await runAdaptiveBatch(partNumbers, 4, 1, 4, async PartNumber => {
        const start = (PartNumber - 1) * partSize;
        const result = await client.send(new UploadPartCopyCommand({
          Bucket: this.bucket, Key: targetKey, UploadId, PartNumber, CopySource,
          CopySourceIfMatch: head.ETag ?? etag,
          CopySourceRange: 'bytes=' + start + '-' + Math.min(size - 1, start + partSize - 1),
        }), options);
        if (!result.CopyPartResult?.ETag) throw new Error('Missing copied part ETag');
        parts.push({PartNumber, ETag: result.CopyPartResult.ETag});
      });
      await client.send(new CompleteMultipartUploadCommand({
        Bucket: this.bucket, Key: targetKey, UploadId,
        MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
      }), options);
    } catch (error) {
      // The request may already be aborted; cleanup needs its own bounded signal.
      await client.send(new AbortMultipartUploadCommand({Bucket: this.bucket, Key: targetKey, UploadId}),
        { abortSignal: AbortSignal.timeout(10000) }).catch(cleanupError => {
          console.error('[Storage] Failed to abort multipart copy', cleanupError);
        });
      throw error;
    }
  }

  async copyPrefix(sourcePrefix: string, targetPrefix: string): Promise<void> {
    const normalizedSource = directoryPrefix(sourcePrefix);
    const normalizedTarget = directoryPrefix(targetPrefix);
    if (normalizedSource === normalizedTarget || normalizedTarget.startsWith(normalizedSource) ||
        normalizedSource.startsWith(normalizedTarget)) throw new Error('Overlapping storage prefixes');
    if (!this.client) throw new Error('S3 is not configured');
    const maximum = Math.max(1, Math.min(20, config.optimizations.s3AdaptiveMaxConcurrency));
    const minimum = config.optimizations.s3AdaptiveCopyEnabled
      ? config.optimizations.s3AdaptiveMinConcurrency : maximum;
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: normalizedSource, ContinuationToken: continuationToken,
      }), {abortSignal: requestSignal()});
      await runAdaptiveBatch(response.Contents ?? [], maximum, minimum, maximum, async object => {
        if (!object.Key || object.Size === undefined) throw new Error('Incomplete copy listing');
        const targetKey = normalizedTarget + object.Key.slice(normalizedSource.length);
        await this.copyObject(object.Key, targetKey, object.Size, object.ETag);
      });
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
  }

  async getStream(key: string, signal?: AbortSignal): Promise<ReadableStream | null> {
    if (!this.client) {
      return null;
    }

    const effectiveSignal = requestSignal(signal);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
        { abortSignal: effectiveSignal },
      );

      if (!response.Body) {
        return null;
      }

      return boundedStream(response.Body.transformToWebStream(), Infinity,
        () => new Error('Storage response too large'), effectiveSignal);
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}

export class LocalStorageBackend implements StorageBackend {
  type: StorageType = 'local';
  private basePath: string;
  private initPromise: Promise<void> | null = null;

  constructor(basePath = config.storage.localPath) {
    this.basePath = basePath;
  }

  async getWithMetadata(key: string): Promise<StoredObject | null> {
    const data = await this.get(key);
    return data ? { data, etag: createHash('sha256').update(data).digest('hex') } : null;
  }

  async listDirectoryPage(prefix: string, options: DirectoryPageOptions): Promise<DirectoryPage> {
    const after = options.cursor ?? options.startAfter;
    const names = (await this.listDirectory(prefix))
      .filter(name => !after || name + '/' > after + '/')
      .sort((a, b) => a + '/' < b + '/' ? -1 : a === b ? 0 : 1);
    const entries = names.slice(0, Math.max(1, Math.min(1000, options.limit)));
    return { entries, nextCursor: names.length > entries.length ? entries[entries.length - 1] : null };
  }

  async copyObject(key: string, targetKey: string, _size: number, etag?: string): Promise<void> {
    const source = await this.getWithMetadata(key);
    if (!source || (etag && source.etag !== etag)) throw new Error('Copy source changed or missing');
    await this.put(targetKey, source.data);
  }

  private ensureBasePath(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          await stat(this.basePath);
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            await mkdir(this.basePath, { recursive: true });
            return;
          }
          throw error;
        }
      })();
    }
    return this.initPromise;
  }

  /**
   * Resolve key under basePath and reject path traversal outside the storage root.
   */
  private getFullPath(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('Invalid storage key');
    }
    if (key.includes('\0') || key.includes('\\')) {
      throw new Error('Invalid storage key');
    }
    // Normalize and reject .. segments
    const normalizedKey = key.replace(/\/+/g, '/').replace(/^\//, '');
    if (normalizedKey.split('/').some((seg) => seg === '..' || seg === '.')) {
      throw new Error('Invalid storage key: path traversal');
    }
    const base = resolve(this.basePath);
    const full = resolve(base, normalizedKey);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new Error('Invalid storage key: escapes storage root');
    }
    return full;
  }

  async get(key: string): Promise<Buffer | null> {
    await this.ensureBasePath();
    try {
      const fullPath = this.getFullPath(key);
      const data = await readFile(fullPath);
      return data;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async put(key: string, body: Buffer | Uint8Array | string): Promise<void> {
    await this.ensureBasePath();
    const fullPath = this.getFullPath(key);
    const dir = dirname(fullPath);
    await mkdir(dir, { recursive: true });
    await atomicWriteFile(fullPath, body, join(this.basePath, '.writes'), requestSignal());
  }

  async delete(key: string): Promise<void> {
    try {
      const fullPath = this.getFullPath(key);
      await unlink(fullPath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const fullPath = this.getFullPath(key);
      await stat(fullPath);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async getSize(key: string): Promise<number | null> {
    await this.ensureBasePath();
    try {
      const fullPath = this.getFullPath(key);
      const fileStat = await stat(fullPath);
      return fileStat.isFile() ? fileStat.size : null;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async *walkLocalKeys(fullPath: string, prefix: string): AsyncGenerator<string> {
    const entries = await readdir(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(fullPath, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        yield* this.walkLocalKeys(entryPath, key);
      } else if (entry.isFile()) {
        yield key;
      }
    }
  }

  async list(prefix: string): Promise<string[]> {
    await this.ensureBasePath();
    const fullPath = this.getFullPath(prefix);

    try {
      await stat(fullPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const keys: string[] = [];
    for await (const key of this.walkLocalKeys(fullPath, prefix.replace(/\/$/, ''))) {
      keys.push(key);
      if (keys.length >= MAX_LOCAL_LIST_KEYS) {
        console.warn(
          `[Storage] local list truncated at ${MAX_LOCAL_LIST_KEYS} keys for prefix ${prefix}`,
        );
        break;
      }
    }

    return keys;
  }

  async listDirectory(prefix: string): Promise<string[]> {
    await this.ensureBasePath();
    try {
      return (await readdir(this.getFullPath(directoryPrefix(prefix)))).sort();
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return [];
      throw error;
    }
  }

  async hasPrefix(prefix: string): Promise<boolean> {
    return (await this.listDirectory(prefix)).length > 0;
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.ensureBasePath();
    const fullPath = this.getFullPath(prefix);

    try {
      await stat(fullPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    await rm(fullPath, { recursive: true, force: true });
  }

  async copyPrefix(sourcePrefix: string, targetPrefix: string): Promise<void> {
    await this.ensureBasePath();
    const sourcePath = this.getFullPath(sourcePrefix);

    try {
      await stat(sourcePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const normalizedSource = directoryPrefix(sourcePrefix);
    const normalizedTarget = directoryPrefix(targetPrefix);
    if (normalizedSource === normalizedTarget || normalizedTarget.startsWith(normalizedSource) ||
        normalizedSource.startsWith(normalizedTarget)) throw new Error('Overlapping storage prefixes');
    const BATCH_SIZE = 20;
    let batch: Array<{ sourceKey: string; targetKey: string }> = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      const current = batch;
      batch = [];
      await Promise.all(
        current.map(async ({ sourceKey, targetKey }) => {
          const data = await this.get(sourceKey);
          if (data) {
            await this.put(targetKey, data);
          }
        }),
      );
    };

    for await (const sourceKey of this.walkLocalKeys(sourcePath, normalizedSource.slice(0, -1))) {
      const suffix = sourceKey.slice(normalizedSource.length);
      const targetKey = `${normalizedTarget}${suffix}`;
      batch.push({ sourceKey, targetKey });
      if (batch.length >= BATCH_SIZE) {
        await flushBatch();
      }
    }

    await flushBatch();
  }

  async getStream(key: string, signal?: AbortSignal): Promise<ReadableStream | null> {
    const fullPath = this.getFullPath(key);
    const file = Bun.file(fullPath);
    if (!(await file.exists())) return null;
    return boundedStream(file.stream(), Infinity, () => new Error('Storage response too large'),
      requestSignal(signal));
  }

}

export function getStorageBackend(): StorageBackend {
  const type = config.storage.type;

  if (type === 'local') {
    if (!localBackend) {
      localBackend = new LocalStorageBackend();
    }
    return localBackend;
  }

  if (!s3Backend) {
    s3Backend = new S3StorageBackend();
  }
  return s3Backend;
}

let s3Backend: S3StorageBackend | null = null;
let localBackend: LocalStorageBackend | null = null;
const objectReadCache = createObjectReadCache();

export const getRepoPrefix = (owner: string, repo: string): string => {
  return `repos/${owner}/${repo}`;
};

export const getObject = async (key: string): Promise<Buffer | null> => {
  const storage = getStorageBackend();
  return storage.type === 's3' ? objectReadCache.get(key, () => storage.get(key)) : storage.get(key);
};

export const getObjectWithMetadata = (key: string): Promise<StoredObject | null> =>
  getStorageBackend().getWithMetadata(key);

export const copyObject = async (key: string, targetKey: string, size: number, etag?: string): Promise<void> => {
  objectReadCache.invalidate(targetKey);
  try { await getStorageBackend().copyObject(key, targetKey, size, etag); }
  finally { objectReadCache.invalidate(targetKey); }
};

export const putObject = async (
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<void> => {
  const storage = getStorageBackend();
  objectReadCache.invalidate(key);
  try { await storage.put(key, body, contentType); }
  finally { objectReadCache.invalidate(key); }
};

export const deleteObject = async (key: string): Promise<void> => {
  const storage = getStorageBackend();
  objectReadCache.invalidate(key);
  try { await storage.delete(key); }
  finally { objectReadCache.invalidate(key); }
};

export const objectExists = async (key: string): Promise<boolean> => {
  const storage = getStorageBackend();
  return storage.exists(key);
};

export const getObjectSize = async (key: string): Promise<number | null> => {
  const storage = getStorageBackend();
  return storage.getSize(key);
};

export const listObjects = async (prefix: string): Promise<string[]> => {
  const storage = getStorageBackend();
  return storage.list(prefix);
};

export const deletePrefix = async (prefix: string): Promise<void> => {
  const storage = getStorageBackend();
  objectReadCache.invalidate(prefix, true);
  try { await storage.deletePrefix(prefix); }
  finally { objectReadCache.invalidate(prefix, true); }
};

export const copyPrefix = async (sourcePrefix: string, targetPrefix: string): Promise<void> => {
  const storage = getStorageBackend();
  objectReadCache.invalidate(targetPrefix, true);
  try { await storage.copyPrefix(sourcePrefix, targetPrefix); }
  finally { objectReadCache.invalidate(targetPrefix, true); }
};

export const getObjectStream = async (key: string, signal?: AbortSignal): Promise<ReadableStream | null> => {
  const storage = getStorageBackend();
  return storage.getStream(key, signal);
};

export const listDirectory = (prefix: string): Promise<string[]> => getStorageBackend().listDirectory(prefix);
export const listDirectoryPage = (prefix: string, options: DirectoryPageOptions): Promise<DirectoryPage> =>
  getStorageBackend().listDirectoryPage(prefix, options);
export const prefixExists = (prefix: string): Promise<boolean> => getStorageBackend().hasPrefix(prefix);
