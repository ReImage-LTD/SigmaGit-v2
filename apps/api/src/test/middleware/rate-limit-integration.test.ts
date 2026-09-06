import {
  getClientIp,
  ingressRateLimit,
  rateLimitMiddleware,
  writeRateLimit,
  resolveRateLimitTier,
} from '../../middleware/rate-limit';
import { ipInCidr, normalizeIp, resolveForwardedClientIp } from '../../security/client-ip';
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { AuthVariables } from '../../middleware/auth';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { config } from '../../config';
import { Hono } from 'hono';

afterEach(() => mock.restore());
let nextIp = 1;
const transport = () => ({
  requestIP: () => ({ address: `203.0.113.${nextIp++}`, family: 'IPv4', port: 80 }),
});
function fixedTransport() {
  const ip = transport().requestIP();
  return { requestIP: () => ip };
}

describe('rate-limit enforcement', () => {
  for (const status of [200, 400] as const) {
    it(`charges auth once before work, including ${status} responses and parallel attempts`, async () => {
      const app = new Hono();
      let handled = 0;
      app.use('*', rateLimitMiddleware);
      app.use('*', writeRateLimit);
      app.post('/api/auth/forgot-password', (c) => {
        handled++;
        return c.json({ ok: true }, status);
      });
      const env = fixedTransport();
      const quota = config.isProduction
        ? Math.max(1, Math.floor(config.rateLimit.auth / 4))
        : config.rateLimit.auth;
      const responses = await Promise.all(
        Array.from({ length: quota + 2 }, () =>
          app.fetch(
            new Request('http://localhost/api/auth/forgot-password', { method: 'POST' }),
            env,
          ),
        ),
      );
      expect(handled).toBe(quota);
      expect(responses.filter((r) => r.status === 429)).toHaveLength(2);
      expect(responses.find((r) => r.status === 429)?.headers.has('retry-after')).toBe(true);
    });
  }

  it('fails closed for authentication when the store errors', async () => {
    spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(new Error('store unavailable'));
    const app = new Hono();
    app.use('*', rateLimitMiddleware);
    app.post('/api/auth/sign-in/email', (c) => c.json({ unexpected: true }));
    const response = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/email', { method: 'POST' }),
      fixedTransport(),
    );
    expect(response.status).toBe(503);
  });

  it('applies the aggregate budget before resolving auth and limits real Git paths too', async () => {
    const consume = spyOn(RateLimiterMemory.prototype, 'consume').mockRejectedValue(
      new Error('offline'),
    );
    let authCalls = 0;
    const app = new Hono();
    app.use('*', ingressRateLimit);
    app.use('*', async (_, next) => {
      authCalls++;
      await next();
    });
    app.get('/owner/repo.git/info/refs', (c) => c.text('refs'));
    expect(
      (await app.fetch(new Request('http://localhost/owner/repo.git/info/refs'), fixedTransport()))
        .status,
    ).toBe(503);
    expect(authCalls).toBe(0);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('ignores key rotation for writes and search and does not exempt Git-looking names', async () => {
    const app = new Hono<{ Variables: AuthVariables }>();
    app.all('*', (c) => c.json({ tier: resolveRateLimitTier(c) }));
    for (const [path, method, expected] of [
      ['/api/search', 'GET', 'search'],
      ['/api/repositories', 'POST', 'public-write'],
      ['/api/repositories/alice/git-upload-pack/info', 'GET', 'unauth'],
      ['/api/auth/get-session', 'GET', 'unauth'],
    ]) {
      const response = await app.request(path, {
        method,
        headers: { 'x-api-key': crypto.randomUUID() },
      });
      expect(await response.json()).toEqual({ tier: expected });
    }
  });
});

describe('socket and proxy identity', () => {
  it('uses the real peer and ignores untrusted forwarding headers', async () => {
    const app = new Hono<{ Variables: AuthVariables }>();
    app.get('/', (c) => c.text(getClientIp(c)));
    const response = await app.fetch(
      new Request('http://localhost/', { headers: { 'x-forwarded-for': '1.2.3.4' } }),
      {
        requestIP: () => ({ address: '203.0.113.200', family: 'IPv4', port: 80 }),
      },
    );
    expect(await response.text()).toBe('203.0.113.200');
  });

  it('canonicalizes IPv6 and mapped addresses and matches IPv6 proxy networks', () => {
    expect(normalizeIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(normalizeIp('fe80::1%eth0')).toBeNull();
    expect(normalizeIp('2001:0db8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(ipInCidr('172.18.0.1oops', '172.16.0.0/12')).toBe(false);
    expect(ipInCidr('172.18.0.1', '172.16.0.0/12oops')).toBe(false);
    expect(
      resolveForwardedClientIp('2001:db8::1', '192.0.2.2, 2001:db8::2', ['2001:db8::/32']),
    ).toBe('192.0.2.2');
    expect(resolveForwardedClientIp('2001:db8::1', 'arbitrary-key', ['2001:db8::/32'])).toBeNull();
  });
});
