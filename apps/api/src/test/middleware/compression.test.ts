import { compressionMiddleware } from '../../middleware/compression';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

const body = 'response content '.repeat(200);

function makeApp(headers: Record<string, string> = {}, content: string | Buffer = body) {
  const app = new Hono();
  app.use('*', compressionMiddleware);
  app.get(
    '/test',
    (c) =>
      new Response(content, {
        headers: { 'Content-Type': 'text/plain', Vary: 'Origin', ...headers },
      }),
  );
  return app;
}

describe('response compression', () => {
  for (const encoding of ['gzip;q=0', 'gzip;q=0, *;q=1', 'notgzip', 'gzip;q=invalid', '']) {
    it(`keeps identity content when gzip is not accepted: ${encoding}`, async () => {
      const response = await makeApp().request('/test', {
        headers: { 'Accept-Encoding': encoding },
      });
      expect(response.headers.has('content-encoding')).toBe(false);
      expect(response.headers.get('vary')).toBe('Origin, Accept-Encoding');
      expect(await response.text()).toBe(body);
    });
  }

  for (const encoding of ['gzip', 'GZIP; q=0.5', '*;q=1']) {
    it(`compresses accepted gzip and preserves cache variation: ${encoding}`, async () => {
      const response = await makeApp({ ETag: '"original"' }).request('/test', {
        headers: { 'Accept-Encoding': encoding },
      });
      expect(response.headers.get('content-encoding')).toBe('gzip');
      expect(response.headers.get('vary')).toBe('Origin, Accept-Encoding');
      expect(response.headers.get('etag')).toBe('W/"original"');
      expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(body);
    });
  }

  it('does not double-compress existing encoded content', async () => {
    const compressed = gzipSync(body);
    const response = await makeApp({ 'Content-Encoding': 'gzip' }, compressed).request('/test', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(Buffer.from(await response.arrayBuffer())).toEqual(compressed);
  });

  const ineligibleHeaders: Record<string, string>[] = [
    { 'Content-Type': 'text/event-stream' },
    { 'Cache-Control': 'public, no-transform' },
    { 'Content-Range': 'bytes 0-99/1000' },
    { 'Content-Length': '10' },
  ];
  for (const headers of ineligibleHeaders) {
    it(`skips ineligible responses: ${JSON.stringify(headers)}`, async () => {
      const response = await makeApp(headers).request('/test', {
        headers: { 'Accept-Encoding': 'gzip' },
      });
      expect(response.headers.has('content-encoding')).toBe(false);
      expect(await response.text()).toBe(body);
    });
  }
});
