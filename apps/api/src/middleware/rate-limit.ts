import {
  RateLimiterRedis,
  RateLimiterMemory,
  RateLimiterAbstract,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import { secureCompare } from '../security/secrets';
import { createMiddleware } from 'hono/factory';
import type { AuthVariables } from './auth';
import { getRedisSession } from '../redis';
import { createHash } from 'node:crypto';
import { getConnInfo } from 'hono/bun';
import type { Context } from 'hono';
import { config } from '../config';

type RateLimitContext = Context<{ Variables: AuthVariables }>;

export type RateLimitTier = 'general' | 'auth' | 'write' | 'search' | 'unauth' | 'api-key';

interface RateLimitConfig {
  keyPrefix: string;
  points: number;
  duration: number;
  blockDuration: number;
}

const RATE_LIMIT_CONFIGS: Record<RateLimitTier, RateLimitConfig> = {
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
  'api-key': {
    keyPrefix: 'rl_apikey',
    points: config.rateLimit.apiKey,
    duration: 60,
    blockDuration: 0,
  },
};

const limiters = new Map<RateLimitTier, RateLimiterAbstract>();

async function getLimiter(tier: RateLimitTier): Promise<RateLimiterAbstract> {
  const existing = limiters.get(tier);
  if (existing) return existing;

  const tierConfig = RATE_LIMIT_CONFIGS[tier];
  const redis = await getRedisSession();

  let limiter: RateLimiterAbstract;

  if (redis) {
    limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: tierConfig.keyPrefix,
      points: tierConfig.points,
      duration: tierConfig.duration,
      blockDuration: tierConfig.blockDuration,
      useRedisPackage: true,
    });
  } else {
    const memoryDuration = config.isProduction
      ? Math.min(tierConfig.duration, 300)
      : tierConfig.duration;
    const memoryPoints = config.isProduction
      ? Math.max(1, Math.floor(tierConfig.points / 4))
      : tierConfig.points;

    if (config.isProduction) {
      console.warn(
        `[RateLimit] Redis unavailable — using in-memory fallback for ${tier} (${memoryPoints}/${memoryDuration}s)`,
      );
    }

    limiter = new RateLimiterMemory({
      keyPrefix: tierConfig.keyPrefix,
      points: memoryPoints,
      duration: memoryDuration,
      blockDuration: tierConfig.blockDuration,
    });
  }

  limiters.set(tier, limiter);
  return limiter;
}

function isGitProtocolPath(path: string): boolean {
  return (
    path.includes('info/refs') ||
    path.includes('git-upload-pack') ||
    path.includes('git-receive-pack')
  );
}

function isRunnerHeartbeat(path: string): boolean {
  return /^\/api\/runners\/[^/]+\/heartbeat$/.test(path);
}

export function isExcludedPath(path: string): boolean {
  if (path === '/health' || path === '/api/health' || path === '/api/status' || path === '/ws') {
    return true;
  }
  // Internal routes still get rate limiting unless they carry valid internal auth
  // (checked at tier resolution via header). Keep path-level exclusion only for health/ws/git.
  if (isGitProtocolPath(path)) {
    return true;
  }
  if (isRunnerHeartbeat(path)) {
    return true;
  }
  return false;
}

/** Session cookie presence is not auth — only a resolved user is. */
export function isAuthenticated(c: RateLimitContext): boolean {
  return Boolean(c.get('user'));
}

export function hasApiKeyHeader(c: RateLimitContext): boolean {
  const key = c.req.header('x-api-key');
  return typeof key === 'string' && key.length > 0;
}

/** Hash API keys before storing as rate-limit keys. */
export function hashApiKeyForRateLimit(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 32);
}

/**
 * Parse TRUSTED_PROXY_CIDRS (comma-separated) for hop-based IP extraction.
 * When trustProxy is true but no CIDRs configured, only trust the immediate
 * peer via x-real-ip set by the reverse proxy on the last hop — never the
 * left-most (client-controlled) X-Forwarded-For entry alone without hop model.
 */
function parseTrustedProxyCidrs(): string[] {
  return config.trustedProxyCidrs ?? [];
}

/** Simple IPv4 CIDR match for trusted proxy hop model. */
export function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  if (!range || !bitsStr) return ip === cidr;
  const bits = parseInt(bitsStr, 10);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const ipToInt = (s: string) => {
    const p = s.split('.').map((x) => parseInt(x, 10));
    if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
  };
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt == null || rangeInt == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function resolveForwardedClientIp(
  peerIp: string | undefined,
  forwarded: string | undefined,
  trustedCidrs: string[],
): string | null {
  if (!peerIp || !trustedCidrs.some((cidr) => ipv4InCidr(peerIp, cidr))) return null;

  const hops = (forwarded ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  hops.push(peerIp);
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = hops[index]!;
    if (!trustedCidrs.some((cidr) => ipv4InCidr(hop, cidr))) return hop;
  }
  return hops[0] ?? null;
}

/**
 * Resolve client IP. When trustProxy is false, never trust forwarding headers.
 * When trustProxy is true with TRUSTED_PROXY_CIDRS, use right-most untrusted hop
 * from X-Forwarded-For. Without CIDRs, only accept x-real-ip / cf-connecting-ip
 * (set by the edge proxy), never left-most XFF alone.
 */
export function getClientIp(c: RateLimitContext): string {
  if (!config.trustProxy) {
    return 'unknown';
  }

  const cidrs = parseTrustedProxyCidrs();
  let peerIp: string | undefined;
  try {
    peerIp = getConnInfo(c).remote.address;
  } catch {
    return 'unknown';
  }
  const forwarded = c.req.header('x-forwarded-for');
  return resolveForwardedClientIp(peerIp, forwarded, cidrs) ?? 'unknown';
}

export function resolveRateLimitTier(c: RateLimitContext): RateLimitTier | null {
  const path = c.req.path;
  const method = c.req.method;

  if (isExcludedPath(path)) {
    return null;
  }

  // Valid internal secret bypasses rate limits for worker-to-API paths only.
  if (path.startsWith('/api/internal/')) {
    const secret = config.internalApiSecret;
    const provided = c.req.header('x-internal-auth');
    if (secret && provided && secureCompare(provided, secret)) {
      return null;
    }
    // Unauthenticated internal probes still rate-limited as unauth.
    return 'unauth';
  }

  if (path.startsWith('/api/auth/')) {
    return 'auth';
  }

  // API key tier when a key is present and user is not resolved via session.
  if (hasApiKeyHeader(c) && !c.get('user')) {
    return 'api-key';
  }

  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return 'write';
  }

  if (method === 'GET' && path.startsWith('/api/search')) {
    return 'search';
  }

  if (isAuthenticated(c)) {
    return 'general';
  }

  return 'unauth';
}

export function getRateLimitKey(c: RateLimitContext, tier: RateLimitTier): string {
  if (tier === 'auth' || tier === 'unauth') {
    return getClientIp(c);
  }

  const user = c.get('user');
  if (user) {
    return `user:${user.id}`;
  }

  if (tier === 'api-key' || hasApiKeyHeader(c)) {
    const raw = c.req.header('x-api-key') || '';
    return `apikey:${hashApiKeyForRateLimit(raw)}`;
  }

  return getClientIp(c);
}

function setRateLimitHeaders(
  c: RateLimitContext,
  res: RateLimiterRes,
  tierConfig: RateLimitConfig,
) {
  c.header('RateLimit-Limit', String(tierConfig.points));
  c.header('RateLimit-Remaining', String(Math.max(0, res.remainingPoints)));
  c.header('RateLimit-Reset', String(Math.ceil(res.msBeforeNext / 1000)));
  c.header('RateLimit-Policy', `${tierConfig.points};w=${tierConfig.duration}`);
}

function rateLimitExceeded(c: RateLimitContext, res: RateLimiterRes) {
  const retryAfter = Math.ceil(res.msBeforeNext / 1000);
  c.header('Retry-After', String(retryAfter));
  return c.json({ error: 'Too many requests', retryAfter }, 429);
}

type ConsumeResult =
  | { status: 'ok' }
  | { status: 'limited'; res: RateLimiterRes }
  | { status: 'error' };

async function consumeTier(c: RateLimitContext, tier: RateLimitTier): Promise<ConsumeResult> {
  const limiter = await getLimiter(tier);
  const tierConfig = RATE_LIMIT_CONFIGS[tier];
  const key = getRateLimitKey(c, tier);

  try {
    const res = await limiter.consume(key);
    setRateLimitHeaders(c, res, tierConfig);
    return { status: 'ok' };
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      setRateLimitHeaders(c, err, tierConfig);
      return { status: 'limited', res: err };
    }
    console.error(`[RateLimit] Limiter error (${tier}):`, err);
    return { status: 'error' };
  }
}

async function getAuthLimiterState(c: RateLimitContext): Promise<RateLimiterRes | null> {
  try {
    const limiter = await getLimiter('auth');
    const res = await limiter.get(getClientIp(c));
    if (!res) return null;

    setRateLimitHeaders(c, res, RATE_LIMIT_CONFIGS.auth);
    if (res.remainingPoints <= 0) {
      return res;
    }
    return null;
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      setRateLimitHeaders(c, err, RATE_LIMIT_CONFIGS.auth);
      return err;
    }
    console.error('[RateLimit] Auth pre-check error:', err);
    return null;
  }
}

async function consumeAuthOnFailure(c: RateLimitContext): Promise<void> {
  const limiter = await getLimiter('auth');
  const tierConfig = RATE_LIMIT_CONFIGS.auth;
  const key = getClientIp(c);

  try {
    const res = await limiter.consume(key);
    setRateLimitHeaders(c, res, tierConfig);
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      setRateLimitHeaders(c, err, tierConfig);
      return;
    }
    console.error('[RateLimit] Auth failure limiter error:', err);
  }
}

async function handleAuthTier(c: RateLimitContext, next: () => Promise<void>) {
  const blocked = await getAuthLimiterState(c);
  if (blocked) {
    return rateLimitExceeded(c, blocked);
  }

  await next();

  const status = c.res.status;
  if (status >= 400 && status < 500) {
    await consumeAuthOnFailure(c);
  }
}

function createTierRateLimiter(tier: RateLimitTier, skipPaths: string[] = []) {
  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    if (skipPaths.some((p) => path === p || path.startsWith(p))) {
      await next();
      return;
    }

    const result = await consumeTier(c, tier);
    if (result.status === 'limited') {
      return rateLimitExceeded(c, result.res);
    }
    // Fail closed in production on limiter infrastructure errors.
    if (result.status === 'error' && config.isProduction) {
      return c.json({ error: 'Rate limit unavailable, try again later' }, 503);
    }

    await next();
  });
}

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const tier = resolveRateLimitTier(c);

  if (!tier) {
    await next();
    return;
  }

  if (tier === 'auth') {
    return handleAuthTier(c, next);
  }

  const result = await consumeTier(c, tier);
  if (result.status === 'limited') {
    return rateLimitExceeded(c, result.res);
  }
  if (result.status === 'error' && config.isProduction) {
    return c.json({ error: 'Rate limit unavailable, try again later' }, 503);
  }

  await next();
});

export const authRateLimitOnFailure = createMiddleware(async (c, next) => {
  if (!c.req.path.startsWith('/api/auth/')) {
    await next();
    return;
  }

  return handleAuthTier(c, next);
});

export const generalRateLimit = rateLimitMiddleware;
export const authRateLimit = createTierRateLimiter('auth', ['/ws']);
export const writeRateLimit = createTierRateLimiter('write', ['/ws']);

export const apiKeyRateLimit = createMiddleware(async (c, next) => {
  const apiKey = c.req.header('x-api-key');
  if (!apiKey) {
    await next();
    return;
  }

  const limiter = await getLimiter('api-key');
  const tierConfig = RATE_LIMIT_CONFIGS['api-key'];
  const key = `apikey:${hashApiKeyForRateLimit(apiKey)}`;

  try {
    const res = await limiter.consume(key);
    setRateLimitHeaders(c, res, tierConfig);
    await next();
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      setRateLimitHeaders(c, err, tierConfig);
      const retryAfter = Math.ceil(err.msBeforeNext / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'API key rate limit exceeded', retryAfter }, 429);
    }
    console.error('[RateLimit] API key limiter error:', err);
    if (config.isProduction) {
      return c.json({ error: 'Rate limit unavailable, try again later' }, 503);
    }
    await next();
  }
});

export function unauthenticatedRateLimit() {
  return createMiddleware(async (c, next) => {
    if (isExcludedPath(c.req.path) || isAuthenticated(c)) {
      await next();
      return;
    }

    const result = await consumeTier(c, 'unauth');
    if (result.status === 'limited') {
      return rateLimitExceeded(c, result.res);
    }
    if (result.status === 'error' && config.isProduction) {
      return c.json({ error: 'Rate limit unavailable, try again later' }, 503);
    }

    await next();
  });
}

let activeRestRequests = 0;
let activeGitRequests = 0;

function isConcurrencyExcludedPath(path: string): boolean {
  return path === '/health' || path === '/api/health' || path === '/api/status' || path === '/ws';
}

export function concurrencyLimiter() {
  return createMiddleware(async (c, next) => {
    const path = c.req.path;

    if (isConcurrencyExcludedPath(path)) {
      await next();
      return;
    }

    const isGit = isGitProtocolPath(path);
    const maxConcurrent = isGit ? config.maxConcurrentGit : config.maxConcurrentRest;
    const activeCount = isGit ? activeGitRequests : activeRestRequests;

    if (activeCount >= maxConcurrent) {
      return c.json({ error: 'Server busy, try again later', retryAfter: 5 }, 503);
    }

    if (isGit) {
      activeGitRequests++;
    } else {
      activeRestRequests++;
    }

    try {
      await next();
    } finally {
      if (isGit) {
        activeGitRequests--;
      } else {
        activeRestRequests--;
      }
    }
  });
}

export default rateLimitMiddleware;
