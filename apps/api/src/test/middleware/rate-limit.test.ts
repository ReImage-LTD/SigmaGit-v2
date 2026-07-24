import {
  getClientIp,
  getRateLimitKey,
  hashApiKeyForRateLimit,
  isAuthenticated,
  isExcludedPath,
  ipv4InCidr,
  resolveForwardedClientIp,
  resolveRateLimitTier,
} from '../../middleware/rate-limit';
import { describe, expect, it } from 'bun:test';

function mockContext(
  path: string,
  method: string,
  options: {
    user?: { id: string } | null;
    headers?: Record<string, string | null>;
  } = {},
) {
  const headers = options.headers ?? {};
  return {
    req: {
      path,
      method,
      header: (name: string) => {
        const key = name.toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === key) return v;
        }
        return null;
      },
    },
    get: (key: string) => (key === 'user' ? (options.user ?? null) : undefined),
  } as any;
}

describe('resolveRateLimitTier', () => {
  it('excludes health probes', () => {
    expect(resolveRateLimitTier(mockContext('/health', 'GET'))).toBe(null);
    expect(resolveRateLimitTier(mockContext('/api/health', 'GET'))).toBe(null);
  });

  it('uses search tier for GET /api/search', () => {
    expect(resolveRateLimitTier(mockContext('/api/search', 'GET', { user: { id: 'u1' } }))).toBe(
      'search',
    );
  });

  it('uses write tier for mutations', () => {
    expect(
      resolveRateLimitTier(mockContext('/api/repositories', 'POST', { user: { id: 'u1' } })),
    ).toBe('write');
  });

  it('uses general tier for authenticated reads', () => {
    expect(resolveRateLimitTier(mockContext('/api/users/me', 'GET', { user: { id: 'u1' } }))).toBe(
      'general',
    );
  });

  it('uses unauth tier for anonymous reads', () => {
    expect(resolveRateLimitTier(mockContext('/api/repositories/public', 'GET'))).toBe('unauth');
  });

  it('excludes git protocol paths', () => {
    expect(resolveRateLimitTier(mockContext('/alice/repo.git/info/refs', 'GET'))).toBe(null);
  });

  it('does not treat raw x-api-key as session auth; uses api-key tier', () => {
    const c = mockContext('/api/repositories', 'GET', {
      user: null,
      headers: { 'x-api-key': 'sigmagit_fake' },
    });
    expect(isAuthenticated(c)).toBe(false);
    expect(resolveRateLimitTier(c)).toBe('api-key');
  });

  it('does not treat cookie containing sigmagit as authenticated', () => {
    const c = mockContext('/api/repositories', 'GET', {
      user: null,
      headers: { cookie: 'sigmagit_dev.session_token=abc' },
    });
    expect(isAuthenticated(c)).toBe(false);
    expect(resolveRateLimitTier(c)).toBe('unauth');
  });
});

describe('getClientIp', () => {
  it('ignores spoofable headers when trustProxy is false', () => {
    // config.trustProxy is env-driven; with default false, headers are ignored
    const c = mockContext('/api/x', 'GET', {
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '5.6.7.8',
        'cf-connecting-ip': '9.9.9.9',
      },
    });
    // When TRUST_PROXY is not true, must not honor client-supplied IPs
    if (process.env.TRUST_PROXY !== 'true') {
      expect(getClientIp(c)).toBe('unknown');
    }
  });
});

describe('trusted proxy resolution', () => {
  const trusted = ['172.16.0.0/12'];

  it('rejects forwarding headers from an untrusted peer', () => {
    expect(resolveForwardedClientIp('203.0.113.10', '1.2.3.4', trusted)).toBeNull();
  });

  it('selects the right-most untrusted hop behind a trusted peer', () => {
    expect(resolveForwardedClientIp('172.18.0.5', '1.2.3.4, 172.18.0.4', trusted)).toBe('1.2.3.4');
  });

  it('matches IPv4 CIDRs exactly', () => {
    expect(ipv4InCidr('172.31.255.255', '172.16.0.0/12')).toBe(true);
    expect(ipv4InCidr('172.32.0.1', '172.16.0.0/12')).toBe(false);
  });
});

describe('getRateLimitKey', () => {
  it('hashes API keys instead of storing raw values', () => {
    const raw = 'sigmagit_super_secret_key_value';
    const c = mockContext('/api/x', 'GET', {
      user: null,
      headers: { 'x-api-key': raw },
    });
    const key = getRateLimitKey(c, 'api-key');
    expect(key).toBe(`apikey:${hashApiKeyForRateLimit(raw)}`);
    expect(key).not.toContain(raw);
  });

  it('uses user id for authenticated keys', () => {
    const c = mockContext('/api/x', 'GET', { user: { id: 'user-42' } });
    expect(getRateLimitKey(c, 'general')).toBe('user:user-42');
  });
});

describe('isExcludedPath', () => {
  it('excludes health and ws but not general api', () => {
    expect(isExcludedPath('/health')).toBe(true);
    expect(isExcludedPath('/ws')).toBe(true);
    expect(isExcludedPath('/api/internal/foo')).toBe(false);
    expect(isExcludedPath('/api/settings')).toBe(false);
  });
});

describe('hashApiKeyForRateLimit', () => {
  it('is stable and truncated', () => {
    const a = hashApiKeyForRateLimit('abc');
    const b = hashApiKeyForRateLimit('abc');
    expect(a).toBe(b);
    expect(a.length).toBe(32);
    expect(hashApiKeyForRateLimit('abc')).not.toBe(hashApiKeyForRateLimit('abd'));
  });
});
