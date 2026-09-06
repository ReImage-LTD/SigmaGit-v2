import { RateLimiterAbstract, RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import type { RedisClientType } from 'redis';

export interface RateLimitConfig {
  keyPrefix: string;
  points: number;
  duration: number;
  blockDuration: number;
}

export function createLimiterProvider<T extends string>(
  configs: Record<T, RateLimitConfig>,
  options: {
    getRedis: () => Promise<RedisClientType | null>;
    isProduction: boolean;
    redisConfigured: boolean;
  },
) {
  const entries = new Map<T, { client: RedisClientType | null; limiter: RateLimiterAbstract }>();
  const pending = new Map<T, Promise<RateLimiterAbstract>>();
  return function getLimiter(tier: T): Promise<RateLimiterAbstract> {
    const inflight = pending.get(tier);
    if (inflight) return inflight;
    const operation = (async () => {
      const client = await options.getRedis();
      if (!client && options.isProduction && options.redisConfigured) {
        throw new Error('Configured rate-limit Redis is unavailable');
      }
      const existing = entries.get(tier);
      if (existing && existing.client === client) return existing.limiter;
      const settings = configs[tier];
      const limiter = client
        ? new RateLimiterRedis({
            ...settings,
            storeClient: client,
            useRedisPackage: true,
            rejectIfRedisNotReady: true,
          })
        : new RateLimiterMemory({
            ...settings,
            points: options.isProduction
              ? Math.max(1, Math.floor(settings.points / 4))
              : settings.points,
          });
      entries.set(tier, { client, limiter });
      return limiter;
    })();
    pending.set(tier, operation);
    const clear = () => pending.delete(tier);
    void operation.then(clear, clear);
    return operation;
  };
}
