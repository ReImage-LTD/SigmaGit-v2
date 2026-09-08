import { mapConcurrent } from '../lib/map-concurrent';
import { concatenateStreams } from '../lib/concatenate-streams';
import { requestSignal } from '../lib/request-context';
/**
 * OCI Distribution (Docker Registry) v2 storage layout.
 * Uses existing S3/local storage with prefix registry/.
 *
 * Layout:
 * - registry/<owner>/<image>/blobs/<alg>/<digestHex>  -> blob content
 * - registry/<owner>/<image>/manifests/<ref>          -> manifest (ref = tag or digest)
 * - registry/_uploads/<uuid>                          -> in-progress blob upload (temp)
 */

import {
  assertSafeRegistryKey,
  isValidManifestRef,
  isValidOciDigest,
  isValidOciImageName,
  isValidOciOwner,
  isValidUploadUuid,
  parseAndValidateImageName,
} from './oci';
import {
  getObject,
  getObjectWithMetadata,
  copyObject,
  putObject,
  objectExists,
  listObjects,
  getObjectStream,
  deletePrefix,
} from '../storage';
import { REGISTRY_MAX_BLOB_BYTES } from '../middleware/limits';
import { createHash } from 'crypto';

const REGISTRY_PREFIX = 'registry/';
const UPLOADS_PREFIX = 'registry/_uploads/';

type UploadIndex = {
  chunks: string[];
  size: number;
};

type ChunkedBlobIndex = {
  kind: 'chunked-v1';
  chunks: string[];
  size: number;
};

function assertOwnerImage(owner: string, imageName: string): void {
  if (!isValidOciOwner(owner) || !isValidOciImageName(imageName)) {
    throw new Error('Invalid registry name');
  }
}

export function getRegistryBlobKey(owner: string, imageName: string, digest: string): string {
  assertOwnerImage(owner, imageName);
  if (!isValidOciDigest(digest)) {
    throw new Error('Invalid registry digest');
  }
  const [alg, hex] = digest.split(':');
  if (!alg || !hex || /[./\\]/.test(hex)) {
    throw new Error('Invalid registry digest');
  }
  return assertSafeRegistryKey(`${REGISTRY_PREFIX}${owner}/${imageName}/blobs/${alg}/${hex}`);
}

function getRegistryBlobChunkIndexKey(owner: string, imageName: string, digest: string): string {
  return assertSafeRegistryKey(`${getRegistryBlobKey(owner, imageName, digest)}.chunks.json`);
}

function getRegistryBlobChunkKey(
  owner: string,
  imageName: string,
  digest: string,
  index: number,
  uploadId: string,
): string {
  if (!isValidUploadUuid(uploadId)) throw new Error("Invalid upload ID");
  assertOwnerImage(owner, imageName);
  if (!isValidOciDigest(digest)) throw new Error('Invalid registry digest');
  if (!Number.isInteger(index) || index < 0 || index > 1_000_000) {
    throw new Error('Invalid chunk index');
  }
  const [alg, hex] = digest.split(':');
  return assertSafeRegistryKey(
    `${REGISTRY_PREFIX}${owner}/${imageName}/blob-chunks/${alg}/${hex}/${uploadId}/${index}`,
  );
}

export function getRegistryManifestKey(owner: string, imageName: string, ref: string): string {
  assertOwnerImage(owner, imageName);
  if (!isValidManifestRef(ref)) {
    throw new Error('Invalid manifest reference');
  }
  // Encode digest refs as single path segment: sha256:hex → sha256__hex
  const safeRef = ref.includes(':') ? ref.replace(':', '__') : ref;
  if (safeRef.includes('/') || safeRef.includes('..') || safeRef.includes('\\')) {
    throw new Error('Invalid manifest reference');
  }
  return assertSafeRegistryKey(`${REGISTRY_PREFIX}${owner}/${imageName}/manifests/${safeRef}`);
}

function getUploadPrefix(uuid: string): string {
  if (!isValidUploadUuid(uuid)) {
    throw new Error('Invalid upload UUID');
  }
  return `${UPLOADS_PREFIX}${uuid}`;
}

function getUploadIndexKey(uuid: string): string {
  return assertSafeRegistryKey(`${getUploadPrefix(uuid)}/index.json`);
}

function getUploadChunkKey(uuid: string, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 1_000_000) {
    throw new Error('Invalid chunk index');
  }
  return assertSafeRegistryKey(`${getUploadPrefix(uuid)}/chunks/${index}`);
}

async function readUploadIndex(uuid: string): Promise<UploadIndex> {
  const raw = await getObject(getUploadIndexKey(uuid));
  if (!raw) return { chunks: [], size: 0 };
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as UploadIndex;
    if (!Array.isArray(parsed.chunks) || typeof parsed.size !== 'number') {
      return { chunks: [], size: 0 };
    }
    return parsed;
  } catch {
    return { chunks: [], size: 0 };
  }
}

async function writeUploadIndex(uuid: string, index: UploadIndex): Promise<void> {
  await putObject(
    getUploadIndexKey(uuid),
    Buffer.from(JSON.stringify(index), 'utf8'),
    'application/json',
  );
}

async function readChunkedBlobIndex(
  owner: string,
  imageName: string,
  digest: string,
): Promise<ChunkedBlobIndex | null> {
  const raw = await getObject(getRegistryBlobChunkIndexKey(owner, imageName, digest));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as ChunkedBlobIndex;
    if (parsed.kind !== 'chunked-v1' || !Array.isArray(parsed.chunks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getUploadKey(uuid: string): string {
  return getUploadPrefix(uuid);
}

export function parseImageName(name: string): { owner: string; imageName: string } | null {
  return parseAndValidateImageName(name);
}

export async function getBlob(
  owner: string,
  imageName: string,
  digest: string,
): Promise<Buffer | null> {
  const key = getRegistryBlobKey(owner, imageName, digest);
  return getObject(key);
}

export async function putBlob(
  owner: string,
  imageName: string,
  digest: string,
  content: Buffer,
): Promise<void> {
  const key = getRegistryBlobKey(owner, imageName, digest);
  await putObject(key, content);
}

async function writeChunkedBlobIndex(
  owner: string,
  imageName: string,
  digest: string,
  chunkKeys: string[],
  total: number,
): Promise<void> {
  const indexPayload: ChunkedBlobIndex = {
    kind: 'chunked-v1',
    chunks: chunkKeys,
    size: total,
  };

  await putObject(getRegistryBlobKey(owner, imageName, digest), Buffer.alloc(0));
  await putObject(
    getRegistryBlobChunkIndexKey(owner, imageName, digest),
    Buffer.from(JSON.stringify(indexPayload), 'utf8'),
    'application/json',
  );
}

export async function blobExists(
  owner: string,
  imageName: string,
  digest: string,
): Promise<boolean> {
  const key = getRegistryBlobKey(owner, imageName, digest);
  return objectExists(key);
}

export async function getManifest(
  owner: string,
  imageName: string,
  ref: string,
): Promise<Buffer | null> {
  const key = getRegistryManifestKey(owner, imageName, ref);
  return getObject(key);
}

export async function putManifest(
  owner: string,
  imageName: string,
  ref: string,
  content: Buffer,
  contentType?: string,
): Promise<void> {
  const key = getRegistryManifestKey(owner, imageName, ref);
  await putObject(key, content, contentType);
}

export async function manifestExists(
  owner: string,
  imageName: string,
  ref: string,
): Promise<boolean> {
  const key = getRegistryManifestKey(owner, imageName, ref);
  return objectExists(key);
}

export async function getManifestStream(
  owner: string,
  imageName: string,
  ref: string,
): Promise<ReadableStream | null> {
  const key = getRegistryManifestKey(owner, imageName, ref);
  return getObjectStream(key);
}

export async function listManifestRefs(owner: string, imageName: string): Promise<string[]> {
  assertOwnerImage(owner, imageName);
  const prefix = `${REGISTRY_PREFIX}${owner}/${imageName}/manifests/`;
  const keys = await listObjects(prefix);
  return keys
    .map((k) => k.slice(prefix.length))
    .filter(Boolean)
    .map((ref) => (ref.includes('__') ? ref.replace('__', ':') : ref))
    .filter((ref) => isValidManifestRef(ref));
}

export async function startUpload(uuid: string): Promise<void> {
  await writeUploadIndex(uuid, { chunks: [], size: 0 });
}

export async function getUploadSize(uuid: string): Promise<number> {
  const index = await readUploadIndex(uuid);
  return index.size;
}

export async function appendUploadChunk(uuid: string, chunk: Buffer): Promise<{ size: number }> {
  const index = await readUploadIndex(uuid);
  if (index.size + chunk.length > REGISTRY_MAX_BLOB_BYTES) {
    throw new Error('Upload exceeds maximum blob size');
  }

  const chunkKey = getUploadChunkKey(uuid, index.chunks.length);
  await putObject(chunkKey, chunk);
  const updated: UploadIndex = {
    chunks: [...index.chunks, chunkKey],
    size: index.size + chunk.length,
  };
  await writeUploadIndex(uuid, updated);
  return { size: updated.size };
}

export async function finalizeUpload(
  owner: string,
  imageName: string,
  uuid: string,
  digest: string,
  trailingChunk?: Buffer,
): Promise<{ ok: true } | { ok: false; reason: 'missing' | 'digest_mismatch' | 'too_large' }> {
  const index = await readUploadIndex(uuid);
  const hasChunks = index.chunks.length > 0;
  const hasTrailing = Boolean(trailingChunk && trailingChunk.length > 0);
  const totalSize = index.size + (trailingChunk?.length ?? 0);

  if (!hasChunks && !hasTrailing) {
    return { ok: false, reason: 'missing' };
  }

  if (totalSize > REGISTRY_MAX_BLOB_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  const hash = createHash('sha256');

  if (!hasChunks && hasTrailing && trailingChunk) {
    hash.update(trailingChunk);
    const computed = `sha256:${hash.digest('hex')}`;
    if (computed !== digest) {
      return { ok: false, reason: 'digest_mismatch' };
    }
    await putBlob(owner, imageName, digest, trailingChunk);
    await deleteUpload(uuid);
    return { ok: true };
  }

  const copies: Array<{ key: string; target: string; size: number; etag: string }> = [];
  const chunkKeys: string[] = [];
  let total = 0;
  for (const uploadChunkKey of index.chunks) {
    requestSignal()?.throwIfAborted();
    assertSafeRegistryKey(uploadChunkKey);
    const source = await getObjectWithMetadata(uploadChunkKey);
    if (!source) return { ok: false, reason: 'missing' };
    if (!source.etag) throw new Error('Storage did not return an ETag for verified copy');
    hash.update(source.data);
    total += source.data.length;
    if (total + (trailingChunk?.length ?? 0) > REGISTRY_MAX_BLOB_BYTES) return { ok: false, reason: 'too_large' };
    const target = getRegistryBlobChunkKey(owner, imageName, digest, copies.length, uuid);
    copies.push({ key: uploadChunkKey, target, size: source.data.length, etag: source.etag });
    chunkKeys.push(target);
  }
  if (hasTrailing && trailingChunk) {
    hash.update(trailingChunk);
    total += trailingChunk.length;
    chunkKeys.push(getRegistryBlobChunkKey(owner, imageName, digest, copies.length, uuid));
  }
  if (`sha256:${hash.digest('hex')}` !== digest) return { ok: false, reason: 'digest_mismatch' };

  // Each upload stages into its own directory, so failed copies cannot damage a published blob.
  try {
    await mapConcurrent(copies, 4, async item => {
      requestSignal()?.throwIfAborted();
      await copyObject(item.key, item.target, item.size, item.etag);
    });
    if (hasTrailing && trailingChunk) await putObject(chunkKeys[chunkKeys.length - 1], trailingChunk);
  } catch (error) {
    const stagingPrefix = chunkKeys[0].slice(0, chunkKeys[0].lastIndexOf('/'));
    await deletePrefix(stagingPrefix).catch(() => {});
    throw error;
  }
  await writeChunkedBlobIndex(owner, imageName, digest, chunkKeys, total);
  await deleteUpload(uuid);
  return { ok: true };
}

export async function deleteUpload(uuid: string): Promise<void> {
  await deletePrefix(getUploadPrefix(uuid));
}

export async function streamBlob(
  owner: string,
  imageName: string,
  digest: string,
): Promise<ReadableStream | null> {
  const chunked = await readChunkedBlobIndex(owner, imageName, digest);
  if (!chunked) {
    const key = getRegistryBlobKey(owner, imageName, digest);
    return getObjectStream(key);
  }

  return concatenateStreams(chunked.chunks, async (key, signal) => {
    assertSafeRegistryKey(key);
    return getObjectStream(key, signal);
  }, requestSignal());
}
