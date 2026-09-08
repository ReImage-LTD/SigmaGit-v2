import { ipInCidr, normalizeIp, resolveForwardedClientIp } from '../security/client-ip';
import { isGitProtocolPath, isHealthPath } from '../lib/request-path';
import { createLimiterProvider } from '../lib/rate-limit-store';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { secureCompare } from '../security/secrets';
import { createMiddleware } from 'hono/factory';
import type { AuthVariables } from './auth';
import { getRedisSession } from '../redis';
import { getConnInfo } from 'hono/bun';
import type { Context } from 'hono';
import { config } from '../config';

type RateLimitContext = Context<{ Variables: AuthVariables }>;

export type RateLimitTier =
  | 'runner'
  | 'general'
  | 'auth'
  | 'write'
  | 'search'
  | 'unauth'
  | 'public-write'
  | 'ingress';

interface RateLimitConfig {
  keyPrefix: string;
  points: number;
  duration: number;
  blockDuration: number;
}

const RATE_LIMIT_CONFIGS: Record<RateLimitTier, RateLimitConfig> = {
  runner: { keyPrefix: "rl_runner", points: 600, duration: 60, blockDuration: 0 },
  ingress: {
    keyPrefix: 'rl_ingress',
    points: config.rateLimit.ingress,
    duration: 60,
    blockDuration: 0,
  },
  general: {
    keyPrefix: 'rl_general',
    points: config.rateLimit.general,
    duration: 60,
    blockDuration: 0,
  },
  auth: {
    keyPrefix: 'rl_auth',
    points: config.rateLimit.auth,
    duration: 60,
    blockDuration: 3600,
  },
  write: {
    keyPrefix: 'rl_write',
    points: config.rateLimit.write,
    duration: 60,
    blockDuration: 1800,
  },
  search: {
    keyPrefix: 'rl_search',
    points: config.rateLimit.search,
    duration: 60,
    blockDuration: 0,
  },
  unauth: {
    keyPrefix: 'rl_unauth',
    points: config.rateLimit.unauth,
    duration: 60,
    blockDuration: 0,
  },
  'public-write': {
    keyPrefix: 'rl_public_write',
    points: config.rateLimit.publicWrite,
    duration: 60,
    blockDuration: 0,
  },
};

const getLimiter = createLimiterProvider(RATE_LIMIT_CONFIGS, {
  getRedis: getRedisSession,
  isProduction: config.isProduction,
  redisConfigured: Boolean(config.redisSessionUrl),
});
export { resolveForwardedClientIp } from '../security/client-ip';
export const ipv4InCidr = ipInCidr;

export function isExcludedPath(path: string): boolean {
  return isHealthPath(path) || path === '/ws' || isGitProtocolPath(path);
}

export function isAuthenticated(c: RateLimitContext): boolean {
  return Boolean(c.get('user') || getRegistryRateLimitUserId(c));
}

function getRegistryRateLimitUserId(c: RateLimitContext): string | undefined {
  return c.req.path.startsWith('/v2/') ? c.get('registryRateLimitUserId') : undefined;
}

const clientIps = new WeakMap<object, string>();

export function getClientIp(c: RateLimitContext): string {
  const cached = clientIps.get(c);
  if (cached) return cached;
  const ip = resolveClientIp(c);
  clientIps.set(c, ip);
  return ip;
}

function resolveClientIp(c: RateLimitContext): string {
  let peer: string | null = null;
  try {
    peer = normalizeIp(getConnInfo(c).remote.address);
  } catch {
    // Tests/custom adapters may not supply transport metadata.
  }
  if (!peer) return 'unknown';
  if (!config.trustProxy) return peer;
  return (
    resolveForwardedClientIp(peer, c.req.header('x-forwarded-for'), config.trustedProxyCidrs) ??
    peer
  );
}
export function resolveRateLimitTier(c: RateLimitContext): RateLimitTier | null {
  const path = c.req.path;
  const method = c.req.method;
  if (isExcludedPath(path)) return null;
  if (path.startsWith('/api/runners/') && c.get('runner')) return 'runner';
  if (isInternalRequest(c)) return null;
  // Session reads must not consume the small authentication attempt budget.
  if (path.startsWith('/api/auth/') && method !== 'GET' && method !== 'HEAD') return 'auth';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return isAuthenticated(c) ? 'write' : 'public-write';
  }
  if ((method === 'GET' || method === 'HEAD') && path === '/api/search') return 'search';
  return isAuthenticated(c) ? 'general' : 'unauth';
}

function isInternalRequest(c: RateLimitContext): boolean {
  const provided = c.req.header('x-internal-auth');
  return (
    c.req.path.startsWith('/api/internal/') &&
    Boolean(
      config.internalApiSecret && provided && secureCompare(provided, config.internalApiSecret),
    )
  );
}

export function getRateLimitKey(c: RateLimitContext, tier: RateLimitTier): string {
  if (tier === 'runner') return 'runner:' + c.get('runner')!.id;
  if (tier === 'auth' || tier === 'unauth' || tier === 'ingress' || tier === 'public-write') {
    return getClientIp(c);
  }
  const userId = getRegistryRateLimitUserId(c) ?? c.get('user')?.id;
  return userId ? `user:${userId}` : getClientIp(c);
}

// A route may use the same guard as the global middleware. Charge a bucket once.
const chargedTiers = new WeakMap<object, Set<RateLimitTier>>();

async function enforceTier(
  c: RateLimitContext,
  tier: RateLimitTier,
): Promise<Response | undefined> {
  let charged = chargedTiers.get(c);
  if (!charged) {
    charged = new Set();
    chargedTiers.set(c, charged);
  }
  if (charged.has(tier)) return;
  charged.add(tier);
  try {
    const limiter = await getLimiter(tier);
    const headers = (result: RateLimiterRes) => {
      c.header('RateLimit-Limit', String(limiter.points));
      c.header('RateLimit-Remaining', String(Math.max(0, result.remainingPoints)));
      c.header('RateLimit-Reset', String(Math.ceil(result.msBeforeNext / 1000)));
      c.header('RateLimit-Policy', `${limiter.points};w=${limiter.duration}`);
    };
    try {
      headers(await limiter.consume(getRateLimitKey(c, tier)));
    } catch (error) {
      if (!(error instanceof RateLimiterRes)) throw error;
      headers(error);
      const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests', retryAfter }, 429);
    }
  } catch (error) {
    console.error(
      `[RateLimit] Limiter unavailable (${tier}):`,
      error instanceof Error ? error.message : 'Unknown error',
    );
    // All tiers, including auth, fail closed on infrastructure failures.
    c.header('Retry-After', '5');
    return c.json({ error: 'Rate limit unavailable, try again later' }, 503);
  }
}

/** Shared password-attempt budget for HTTP and protocol authentication. */
export function enforceAuthRateLimit(c: RateLimitContext): Promise<Response | undefined> {
  return enforceTier(c, 'auth');
}

/** Aggregate IP budget runs before auth/session/database work, including Git. */
export const ingressRateLimit = createMiddleware(async (c, next) => {
  if (!isHealthPath(c.req.path) && !isInternalRequest(c)) {
    const response = await enforceTier(c, 'ingress');
    if (response) return response;
  }
  await next();
});

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const tier = resolveRateLimitTier(c);
  if (tier) {
    const response = await enforceTier(c, tier);
    if (response) return response;
  }
  await next();
});

export const generalRateLimit = rateLimitMiddleware;
export const writeRateLimit = rateLimitMiddleware;
export default rateLimitMiddleware;
