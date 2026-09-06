import { isGitProtocolPath, isGitReceivePath } from '../lib/request-path';
import { RequestBodyTooLargeError } from '../lib/request-body';
import { boundedStream } from '../lib/bounded-stream';
import { createMiddleware } from 'hono/factory';

const MAX_REQUEST_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_RESPONSE_SIZE = 50 * 1024 * 1024; // 50MB
const MEMORY_THRESHOLD = 0.92; // 92% of heap
// Don't reject based on ratio alone until the heap is meaningfully large.
// Bun starts with a small heap that grows on demand, so heapUsed/heapTotal
// can spike above 80% at startup even when there's no real memory pressure.
// Set to 1GB so we only start rejecting when we're truly close to 2GB ceiling.
const MIN_HEAP_TO_ENFORCE = 1024 * 1024 * 1024; // 1 GB
export const GIT_PUSH_SIZE_LIMIT = 100 * 1024 * 1024; // 100MB
export const GIT_MAX_OBJECTS_PER_PUSH = 50000;
export const GIT_MAX_UPLOAD_PACK_OBJECTS = 10000;
export const GIT_MAX_DELTA_DEPTH = 100;
export const GIT_MAX_OBJECT_BYTES = 10 * 1024 * 1024; // 10MB per object in pack
export const MAX_FILE_CACHE_BYTES = 256 * 1024; // 256KB — skip Redis cache above this
export const MAX_FILE_SERVE_BYTES = 1024 * 1024; // 1MB — refuse to load larger blobs as text
export const MAX_COMPRESS_BYTES = 256 * 1024; // skip gzip when Content-Length exceeds this
export const MAX_DIFF_FILES = 100;
export const MAX_DIFF_FILE_BYTES = 512 * 1024; // 512KB inflated text per file
export const MAX_DIFF_LINES = 5000; // max lines diffed per file
export const REGISTRY_MAX_CHUNK_BYTES = 50 * 1024 * 1024; // 50MB per upload chunk
export const REGISTRY_MAX_BLOB_BYTES = 512 * 1024 * 1024; // 512MB total blob
export const MAX_LOCAL_LIST_KEYS = 10_000;

/** Endpoint-class body caps (bytes). Applied when Content-Length is present. */
export const BODY_LIMITS = {
  jsonDefault: 1 * 1024 * 1024, // 1MB JSON APIs
  avatar: 5 * 1024 * 1024,
  webhook: 1 * 1024 * 1024,
  registryChunk: REGISTRY_MAX_CHUNK_BYTES,
  gitPack: GIT_PUSH_SIZE_LIMIT,
  absoluteMax: MAX_REQUEST_SIZE,
} as const;

export function resolveBodyLimitForPath(path: string): number {
  if (isGitReceivePath(path)) return BODY_LIMITS.gitPack;
  if (path.startsWith('/v2/')) return BODY_LIMITS.registryChunk;
  if (path === '/api/settings/avatar') return BODY_LIMITS.avatar;
  if (path.includes('/webhooks')) return BODY_LIMITS.webhook;
  if (path.startsWith('/api/')) return BODY_LIMITS.jsonDefault;
  return BODY_LIMITS.absoluteMax;
}

export function shouldRejectRequest(): boolean {
  try {
    const usage = process.memoryUsage();
    const total = usage.heapTotal;
    const used = usage.heapUsed;
    // Only enforce the threshold once the heap has grown to a meaningful size,
    // otherwise Bun's small startup heap makes the ratio always look critical.
    return total >= MIN_HEAP_TO_ENFORCE && used / total > MEMORY_THRESHOLD;
  } catch {
    return false;
  }
}

export function getMemoryUsage(): { used: number; total: number; percent: number } {
  const usage = process.memoryUsage();
  const used = usage.heapUsed;
  const total = usage.heapTotal;
  // In Bun/Node.js, heapUsed can exceed heapTotal during heap growth
  // This is normal - cap the percentage at 1.0 for display purposes
  const percent = total > 0 ? Math.min(used / total, 1.0) : 0;
  return {
    used,
    total,
    percent,
  };
}

export const memoryMiddleware = createMiddleware(async (c, next) => {
  if (shouldRejectRequest()) {
    console.warn('[Memory] Threshold exceeded, rejecting request');
    return c.json({ error: 'Server busy, please try again later' }, 503);
  }

  await next();
});

/**
 * Pure check used by middleware and unit tests.
 * Rejects invalid framing and oversized declared bodies. Actual bytes are
 * independently counted by requestSizeMiddleware, including chunked bodies.
 */
export function evaluateRequestSizeLimit(options: {
  method: string;
  path: string;
  contentLength: string | undefined | null;
  transferEncoding?: string | null;
}): { allowed: boolean; status?: number; error?: string } {
  const { path, contentLength, transferEncoding } = options;
  const isGitReceive = isGitReceivePath(path);
  if (contentLength != null && transferEncoding)
    return { allowed: false, status: 400, error: 'Conflicting body framing headers' };

  if (contentLength) {
    const size = Number(contentLength);
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(size) || size < 0) {
      return { allowed: false, status: 400, error: 'Invalid Content-Length' };
    }
    const pathLimit = resolveBodyLimitForPath(path);
    if (size > pathLimit || size > MAX_REQUEST_SIZE) {
      return { allowed: false, status: 413, error: 'Request body too large' };
    }
    if (isGitReceive && size > GIT_PUSH_SIZE_LIMIT) {
      return { allowed: false, status: 413, error: 'Git pack too large, maximum is 100MB' };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

export const requestSizeMiddleware = createMiddleware(async (c, next) => {
  const result = evaluateRequestSizeLimit({
    method: c.req.method,
    path: c.req.path,
    contentLength: c.req.header('content-length'),
    transferEncoding: c.req.header('transfer-encoding'),
  });
  if (!result.allowed) {
    void c.req.raw.body?.cancel().catch(() => {});
    return c.json({ error: result.error }, (result.status ?? 413) as 400 | 413);
  }
  let exceeded = false;
  const raw = c.req.raw;
  if (raw.body) {
    const limit = resolveBodyLimitForPath(c.req.path);
    c.req.raw = new Request(raw, {
      body: boundedStream(raw.body, limit, (bytes) => {
        exceeded = true;
        return new RequestBodyTooLargeError(bytes, limit);
      }),
    });
  }
  await next();
  // Body parsers or handlers may catch the stream exception. Preserve 413.
  if (exceeded) {
    c.header('Content-Length', undefined);
    c.header('Content-Encoding', undefined);
    c.header('ETag', undefined);
    const response = c.json({ error: 'Request body too large' }, 413);
    void c.res.body?.cancel().catch(() => {});
    c.res = response;
  }
});

export const responseSizeMiddleware = createMiddleware(async (c, next) => {
  await next();
  // Git and registry transfers have their own object/pack/blob limits.
  if (isGitProtocolPath(c.req.path) || c.req.path.startsWith('/v2/')) return;
  const responseSize = Number(c.res.headers.get('content-length'));
  if (responseSize > MAX_RESPONSE_SIZE) {
    c.header('Content-Length', undefined);
    c.header('Content-Encoding', undefined);
    c.header('ETag', undefined);
    const response = c.json({ error: 'Response too large' }, 500);
    void c.res.body?.cancel().catch(() => {});
    c.res = response;
    return;
  }
  if (c.res.body) {
    const response = c.res;
    c.res = new Response(
      boundedStream(response.body!, MAX_RESPONSE_SIZE, () => new Error('Response too large')),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  }
});
export const gitLimitsMiddleware = createMiddleware(async (c, next) => {
  const path = c.req.path;

  if (isGitReceivePath(path)) {
    c.set('maxObjects', GIT_MAX_OBJECTS_PER_PUSH);
    c.set('maxDeltaDepth', GIT_MAX_DELTA_DEPTH);
  }

  await next();
});

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMsg: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(errorMsg));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        clearTimeout(timeoutId);
      });
  });
}

export async function measureMemory<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const before = process.memoryUsage();

  try {
    const result = await fn();
    const after = process.memoryUsage();
    const delta = after.heapUsed - before.heapUsed;

    console.log(`[Memory] ${label}: ${(delta / 1024 / 1024).toFixed(2)} MB delta`);

    return result;
  } catch (error) {
    const after = process.memoryUsage();
    const delta = after.heapUsed - before.heapUsed;

    console.log(`[Memory] ${label} (error): ${(delta / 1024 / 1024).toFixed(2)} MB delta`);

    throw error;
  }
}

export function scheduleGC() {
  if (global.gc) {
    global.gc();
  }
}

export function forceGCIfNeeded(): void {
  const usage = getMemoryUsage();

  if (usage.percent > 0.9) {
    console.warn(`[Memory] Usage at ${(usage.percent * 100).toFixed(2)}%, forcing GC`);
    scheduleGC();
  }
}
