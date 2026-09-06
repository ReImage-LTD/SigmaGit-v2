import { getClientIp, ingressRateLimit } from '../../middleware/rate-limit';
import { requestSizeMiddleware } from '../../middleware/limits';
import { createRequestGuard } from '../../lib/request-guard';
import type { AuthVariables } from '../../middleware/auth';
import { expect, it } from 'bun:test';
import { Hono } from 'hono';

it('preserves Bun socket metadata through the real HTTP handler boundary', async () => {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', ingressRateLimit);
  app.use('*', requestSizeMiddleware);
  app.post('/api/test', async (c) => c.json({ ip: getClientIp(c), body: await c.req.text() }));
  const guarded = createRequestGuard(
    (request, server: { requestIP: (request: Request) => { address: string } | null }, original) =>
      app.fetch(request, { server: { requestIP: () => server.requestIP(original) } }),
    { maxRest: 2, maxGit: 1, timeoutMs: 1000 },
  );
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request, transport) =>
      (await guarded(request, transport)) ?? new Response(null, { status: 500 }),
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/test`, {
      method: 'POST',
      body: 'payload',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ip: '127.0.0.1', body: 'payload' });
  } finally {
    await server.stop(true);
  }
});
