import { Readable, pipeline } from 'node:stream';
import { createMiddleware } from 'hono/factory';
import { MAX_COMPRESS_BYTES } from './limits';
import { createGzip } from 'node:zlib';

const COMPRESSIBLE = /^(?:application\/(?:json|javascript|xml)(?:;|$)|text\/)/i;
const MIN_SIZE = 1024;

const SKIP_PATH_PREFIXES = ['/v2/', '/file/', '/ws'];
const GIT_PATH_PATTERN = /\.git(\/|$)/;

function shouldSkipCompression(path: string): boolean {
  if (SKIP_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true;
  }
  return GIT_PATH_PATTERN.test(path);
}

function gzipWebStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const nodeReadable = Readable.fromWeb(body);
  const gzip = createGzip();
  // Forward source failures and cancel upstream when the response is abandoned.
  pipeline(nodeReadable, gzip, () => {});
  return Readable.toWeb(gzip) as ReadableStream<Uint8Array>;
}

function acceptsGzip(header: string): boolean {
  const encodings = new Map<string, number>();
  for (const entry of header.split(',')) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const [key, value] = parameter.trim().split('=');
      if (key.trim() === 'q') {
        quality =
          value && /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value.trim()) ? Number(value) : 0;
      }
    }
    encodings.set(name, quality);
  }
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0) > 0;
}

export const compressionMiddleware = createMiddleware(async (c, next) => {
  await next();

  if (
    shouldSkipCompression(c.req.path) ||
    c.req.method === 'HEAD' ||
    c.res.headers.has('content-encoding') ||
    c.res.headers.has('content-range') ||
    /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(c.res.headers.get('cache-control') || '')
  ) {
    return;
  }

  const contentType = c.res.headers.get('content-type') || '';
  if (!COMPRESSIBLE.test(contentType) || /^text\/event-stream(?:;|$)/i.test(contentType)) {
    return;
  }

  const contentLengthHeader = c.res.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength)) {
      if (contentLength < MIN_SIZE || contentLength > MAX_COMPRESS_BYTES) {
        return;
      }
    }
  }

  if (!c.res.body) {
    return;
  }

  // Identity responses vary too: a cache must not reuse them for gzip clients.
  const vary = c.res.headers.get('vary');
  if (
    !vary?.split(',').some((value) => ['*', 'accept-encoding'].includes(value.trim().toLowerCase()))
  ) {
    c.header('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  }
  if (!acceptsGzip(c.req.header('accept-encoding') || '')) return;

  // Update Hono's response headers before reading its body: header mutations can
  // replace the Response, and the response setter retains existing headers.
  c.header('Content-Encoding', 'gzip');
  c.header('Content-Length', undefined);
  c.header('Transfer-Encoding', undefined);
  const etag = c.res.headers.get('etag');
  if (etag && !etag.startsWith('W/')) c.header('ETag', `W/${etag}`);
  const headers = new Headers(c.res.headers);
  const compressedStream = gzipWebStream(c.res.body!);

  c.res = new Response(compressedStream, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});
