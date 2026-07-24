import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { csrfMiddleware } from '../../middleware/csrf';

function buildApp() {
  const app = new Hono<{ Variables: { user: { id: string } | null } }>();
  app.use('*', async (c, next) => {
    const asUser = c.req.header('x-test-user') === '1';
    c.set('user', asUser ? { id: 'u1' } : null);
    await next();
  });
  app.use('*', csrfMiddleware as any);
  app.post('/api/x', (c) => c.json({ ok: true }));
  app.get('/api/x', (c) => c.json({ ok: true }));
  return app;
}

describe('csrfMiddleware', () => {
  it('allows safe methods without origin', async () => {
    const app = buildApp();
    const res = await app.request('http://localhost/api/x', {
      method: 'GET',
      headers: { 'x-test-user': '1' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects cookie-authenticated POST without origin', async () => {
    const app = buildApp();
    const res = await app.request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'x-test-user': '1', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('rejects hostile origin', async () => {
    const app = buildApp();
    const res = await app.request('http://localhost/api/x', {
      method: 'POST',
      headers: {
        'x-test-user': '1',
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('allows bearer / api-key without origin (non-browser clients)', async () => {
    const app = buildApp();
    const bearer = await app.request('http://localhost/api/x', {
      method: 'POST',
      headers: {
        'x-test-user': '1',
        authorization: 'Bearer sometoken',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(bearer.status).toBe(200);

    const key = await app.request('http://localhost/api/x', {
      method: 'POST',
      headers: {
        'x-test-user': '1',
        'x-api-key': 'sigmagit_test',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(key.status).toBe(200);
  });

  it('allows allowed localhost origin in development', async () => {
    const app = buildApp();
    const res = await app.request('http://localhost/api/x', {
      method: 'POST',
      headers: {
        'x-test-user': '1',
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    // In non-production, localhost:3000 is in allowed origins
    if (process.env.NODE_ENV !== 'production') {
      expect(res.status).toBe(200);
    }
  });
});
