import { createRecoveringConnection } from '../../lib/recovering-connection';
import { createLimiterProvider } from '../../lib/rate-limit-store';
import { describe, expect, it } from 'bun:test';
import type { RedisClientType } from 'redis';

const configs = { auth: { keyPrefix: 'test', points: 8, duration: 60, blockDuration: 0 } };

describe('rate-limit store lifecycle', () => {
  it('shares first initialization and retains the memory quota', async () => {
    let calls = 0;
    const get = createLimiterProvider(configs, {
      getRedis: async () => {
        calls++;
        return null;
      },
      isProduction: true,
      redisConfigured: false,
    });
    const [a, b] = await Promise.all([get('auth'), get('auth')]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(a.points).toBe(2);
    await a.consume('caller');
    expect((await (await get('auth')).get('caller'))?.remainingPoints).toBe(1);
  });

  it('recovers from unavailable configured Redis without downgrading production quotas', async () => {
    let client: RedisClientType | null = null;
    const get = createLimiterProvider(configs, {
      getRedis: async () => client,
      isProduction: true,
      redisConfigured: true,
    });
    await expect(get('auth')).rejects.toThrow('unavailable');
    client = {} as RedisClientType;
    const first = await get('auth');
    expect(first.points).toBe(8);
    expect(await get('auth')).toBe(first);
    client = {} as RedisClientType;
    expect(await get('auth')).not.toBe(first);
  });

  it('promotes development memory fallback when Redis returns', async () => {
    let client: RedisClientType | null = null;
    const get = createLimiterProvider(configs, {
      getRedis: async () => client,
      isProduction: false,
      redisConfigured: true,
    });
    const memory = await get('auth');
    client = {} as RedisClientType;
    expect(await get('auth')).not.toBe(memory);
  });

  it('serializes connection attempts, does not sleep on backoff, and retries beyond five failures', async () => {
    let now = 0;
    let attempts = 0;
    const pool = createRecoveringConnection({
      now: () => now,
      connect: async () => {
        if (++attempts <= 6) throw new Error('offline');
        return 'connected';
      },
      healthy: async () => true,
      dispose: () => {},
    });
    await Promise.all([pool.get(), pool.get(), pool.get()]);
    expect(attempts).toBe(1);
    expect(await pool.get()).toBeNull();
    expect(attempts).toBe(1);
    for (let i = 0; i < 6; i++) {
      now += 31_000;
      await pool.get();
    }
    expect(await pool.get()).toBe('connected');
    expect(attempts).toBe(7);
  });
});
