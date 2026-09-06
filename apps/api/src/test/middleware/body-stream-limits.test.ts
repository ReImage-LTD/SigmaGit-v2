import {
  requestSizeMiddleware,
  responseSizeMiddleware,
  evaluateRequestSizeLimit,
} from '../../middleware/limits';
import { compressionMiddleware } from '../../middleware/compression';
import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

function chunks(count: number, size: number, cancelled: () => void = () => {}) {
  const chunk = new Uint8Array(size).fill(97);
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (count-- > 0) controller.enqueue(chunk);
      else controller.close();
    },
    cancel: cancelled,
  });
}

describe('stream byte limits', () => {
  for (const length of [undefined, '1']) {
    it(`rejects actual oversized request bytes with declared length ${length}`, async () => {
      let cancelled = false;
      const app = new Hono();
      app.use('*', requestSizeMiddleware);
      app.post('/api/test', async (c) => {
        try {
          await c.req.text();
          return c.text('accepted');
        } catch {
          return c.json({ error: 'parser rejected' }, 400);
        }
      });
      const headers: Record<string, string> = length ? { 'content-length': length } : {};
      const response = await app.request('/api/test', {
        method: 'POST',
        headers,
        body: chunks(3, 600_000, () => {
          cancelled = true;
        }),
      });
      expect(response.status).toBe(413);
      expect(cancelled).toBe(true);
    });
  }

  it('accepts small streamed bodies and rejects malformed framing', async () => {
    const app = new Hono();
    app.use('*', requestSizeMiddleware);
    app.post('/api/test', async (c) => c.text(await c.req.text()));
    const response = await app.request('/api/test', {
      method: 'POST',
      headers: { 'transfer-encoding': 'chunked' },
      body: chunks(2, 3),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('aaaaaa');
    for (const contentLength of ['1oops', '-1', '9007199254740992']) {
      expect(
        evaluateRequestSizeLimit({ path: '/api/test', method: 'POST', contentLength }).status,
      ).toBe(400);
    }
    expect(
      evaluateRequestSizeLimit({
        path: '/api/test',
        method: 'POST',
        contentLength: '1',
        transferEncoding: 'chunked',
      }).status,
    ).toBe(400);
  });

  for (const gzip of [false, true]) {
    it(`stops oversized responses without length headers, gzip=${gzip}`, async () => {
      let cancelled = false;
      const app = new Hono();
      app.use('*', compressionMiddleware);
      app.use('*', responseSizeMiddleware);
      app.get(
        '/api/test',
        () =>
          new Response(
            chunks(52, 1024 * 1024, () => {
              cancelled = true;
            }),
            { headers: { 'content-type': 'text/plain' } },
          ),
      );
      const response = await app.request('/api/test', {
        headers: gzip ? { 'accept-encoding': 'gzip' } : {},
      });
      await expect(response.arrayBuffer()).rejects.toThrow('Response too large');
      expect(cancelled).toBe(true);
    });
  }

  it('rejects oversized advertised responses and removes stale encoding/length headers', async () => {
    const app = new Hono();
    app.use('*', responseSizeMiddleware);
    app.get(
      '/api/test',
      () =>
        new Response('data', {
          headers: { 'content-length': String(60 * 1024 * 1024), 'content-encoding': 'gzip' },
        }),
    );
    const response = await app.request('/api/test');
    expect(response.status).toBe(500);
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('content-encoding')).toBe(false);
    expect(await response.json()).toEqual({ error: 'Response too large' });
  });
});
