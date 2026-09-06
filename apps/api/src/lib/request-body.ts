/**
 * Read a request body from a stream with a hard byte limit.
 * Aborts early if the limit is exceeded instead of buffering unbounded data.
 */
export async function readRequestBodyLimited(request: Request, maxBytes: number): Promise<Buffer> {
  if (!request.body) {
    return Buffer.alloc(0);
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declared = parseInt(contentLength, 10);
    if (!Number.isNaN(declared) && declared > maxBytes) {
      throw new RequestBodyTooLargeError(declared, maxBytes);
    }
  }

  const reader = request.body.getReader();
  const onAbort = () => {
    void reader.cancel(request.signal.reason).catch(() => {});
  };
  request.signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      request.signal.throwIfAborted();
      if (done) break;

      total += value.byteLength;
      if (total > maxBytes) {
        throw new RequestBodyTooLargeError(total, maxBytes);
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    request.signal.removeEventListener('abort', onAbort);
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
  }

  if (chunks.length === 0) {
    return Buffer.alloc(0);
  }
  if (chunks.length === 1) {
    return chunks[0]!;
  }
  return Buffer.concat(chunks);
}

export class RequestBodyTooLargeError extends Error {
  constructor(
    public readonly receivedBytes: number,
    public readonly maxBytes: number,
  ) {
    super(`Request body too large: ${receivedBytes} bytes (max ${maxBytes})`);
    this.name = 'RequestBodyTooLargeError';
  }
}

/** Alias used by unit tests and new call sites. */
export const BodyTooLargeError = RequestBodyTooLargeError;

export async function readBodyLimited(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const buf = await readRequestBodyLimited(request, maxBytes);
  return Uint8Array.from(buf).buffer;
}

export async function readJsonLimited<T = unknown>(request: Request, maxBytes: number): Promise<T> {
  const buf = await readRequestBodyLimited(request, maxBytes);
  if (buf.byteLength === 0) {
    throw new SyntaxError('Empty body');
  }
  return JSON.parse(buf.toString('utf8')) as T;
}
