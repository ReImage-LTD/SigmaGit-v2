import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { readdir, readFile, writeFile, unlink, mkdir, stat, rm } from 'node:fs/promises';
import { MAX_LOCAL_LIST_KEYS } from './middleware/limits';
import { join, dirname, resolve, sep } from 'node:path';
import { requestSignal } from './lib/request-context';
import { boundedStream } from './lib/bounded-stream';
import { config } from './config';

function isThrottleLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = maybe.$metadata?.httpStatusCode;
  return (
    maybe.name === 'SlowDown' || maybe.name === 'Throttling' || status === 429 || status === 503
  );
}

async function runAdaptiveBatch<T>(
  items: T[],
  initialConcurrency: number,
  minConcurrency: number,
  maxConcurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  let concurrency = Math.max(minConcurrency, Math.min(maxConcurrency, initialConcurrency));

  while (index < items.length) {
    const batchItems = items.slice(index, index + concurrency);
    const results = await Promise.allSettled(batchItems.map((item) => task(item)));
    index += batchItems.length;

    const rejected = results.filter((result) => result.status === 'rejected');
    if (rejected.length > 0) {
      const hasThrottle = rejected.some((result) => isThrottleLikeError(result.reason));
      if (hasThrottle) {
        concurrency = Math.max(minConcurrency, Math.floor(concurrency / 2));
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const firstFailure = rejected.find((result) => !isThrottleLikeError(result.reason));
      if (firstFailure && firstFailure.status === 'rejected') {
        throw firstFailure.reason;
      }
      continue;
    }

    if (concurrency < maxConcurrency) {
      concurrency = Math.min(maxConcurrency, concurrency + 1);
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

export interface StorageBackend {
  type: StorageType;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSize(key: string): Promise<number | null>;
  list(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
  copyPrefix(sourcePrefix: string, targetPrefix: string): Promise<void>;
  getStream(key: string): Promise<ReadableStream | null>;
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
      return Buffer.from(bytes);
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

  async deletePrefix(prefix: string): Promise<void> {
    prefix = directoryPrefix(prefix);
    if (!this.client) {
      throw new Error('S3 is not configured');
    }

    const baseBatchSize = Math.max(1, Math.min(50, config.optimizations.s3AdaptiveMaxConcurrency));
    const adaptiveEnabled = config.optimizations.s3AdaptiveDeleteEnabled;
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

      const keys =
        response.Contents?.map((obj) => obj.Key).filter((key): key is string => !!key) ?? [];

      for (let i = 0; i < keys.length; i += baseBatchSize) {
        const batch = keys.slice(i, i + baseBatchSize);
        if (adaptiveEnabled) {
          await runAdaptiveBatch(
            batch,
            baseBatchSize,
            Math.max(1, config.optimizations.s3AdaptiveMinConcurrency),
            Math.max(1, config.optimizations.s3AdaptiveMaxConcurrency),
            (key) => this.delete(key),
          );
        } else {
          await Promise.all(batch.map((key) => this.delete(key)));
        }

        if ((i / baseBatchSize) % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
  }

  async copyPrefix(sourcePrefix: string, targetPrefix: string): Promise<void> {
    const normalizedSource = directoryPrefix(sourcePrefix);
    const normalizedTarget = directoryPrefix(targetPrefix);
    if (normalizedSource === normalizedTarget || normalizedTarget.startsWith(normalizedSource) ||
        normalizedSource.startsWith(normalizedTarget)) throw new Error('Overlapping storage prefixes');
    const baseBatchSize = Math.max(1, Math.min(20, config.optimizations.s3AdaptiveMaxConcurrency));
    const adaptiveEnabled = config.optimizations.s3AdaptiveCopyEnabled;
    let continuationToken: string | undefined;

    do {
      if (!this.client) {
        throw new Error('S3 is not configured');
      }

      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: normalizedSource,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: requestSignal() },
      );

      const keys =
        response.Contents?.map((obj) => obj.Key).filter((key): key is string => !!key) ?? [];

      for (let i = 0; i < keys.length; i += baseBatchSize) {
        const batch = keys.slice(i, i + baseBatchSize);

        const copyOne = async (key: string) => {
          const data = await this.get(key);
          if (!data) {
            return;
          }
          const suffix = key.slice(normalizedSource.length);
          const targetKey = `${normalizedTarget}${suffix}`;
          await this.put(targetKey, data);
        };

        if (adaptiveEnabled) {
          await runAdaptiveBatch(
            batch,
            baseBatchSize,
            Math.max(1, config.optimizations.s3AdaptiveMinConcurrency),
            Math.max(1, config.optimizations.s3AdaptiveMaxConcurrency),
            copyOne,
          );
        } else {
          await Promise.all(batch.map(copyOne));
        }

        if ((i / baseBatchSize) % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
  }

  async getStream(key: string): Promise<ReadableStream | null> {
    if (!this.client) {
      return null;
    }

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
        { abortSignal: requestSignal() },
      );

      if (!response.Body) {
        return null;
      }

      return response.Body.transformToWebStream();
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}

class LocalStorageBackend implements StorageBackend {
  type: StorageType = 'local';
  private basePath: string;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.basePath = config.storage.localPath;
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
    await writeFile(fullPath, body);
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
      return fileStat.size;
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

  async getStream(key: string): Promise<ReadableStream | null> {
    try {
      const fullPath = this.getFullPath(key);

      return new ReadableStream({
        async start(controller) {
          try {
            const fileHandle = await Bun.file(fullPath);
            const stream = fileHandle.stream();
            const reader = stream.getReader();

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
            } finally {
              reader.cancel();
            }

            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
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

export const getRepoPrefix = (owner: string, repo: string): string => {
  return `repos/${owner}/${repo}`;
};

export const getObject = async (key: string): Promise<Buffer | null> => {
  const storage = getStorageBackend();
  return storage.get(key);
};

export const putObject = async (
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<void> => {
  const storage = getStorageBackend();
  return storage.put(key, body, contentType);
};

export const deleteObject = async (key: string): Promise<void> => {
  const storage = getStorageBackend();
  return storage.delete(key);
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
  return storage.deletePrefix(prefix);
};

export const copyPrefix = async (sourcePrefix: string, targetPrefix: string): Promise<void> => {
  const storage = getStorageBackend();
  return storage.copyPrefix(sourcePrefix, targetPrefix);
};

export const getObjectStream = async (key: string): Promise<ReadableStream | null> => {
  const storage = getStorageBackend();
  return storage.getStream(key);
};
