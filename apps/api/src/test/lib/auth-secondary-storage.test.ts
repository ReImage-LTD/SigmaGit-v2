import { createAtomicAuthStorage } from '../../lib/auth-secondary-storage';
import { describe, expect, it, mock } from 'bun:test';

describe('Better Auth atomic secondary storage', () => {
  it('consumes a one-time value using GETDEL', async () => {
    const getDel = mock(async (_key: string): Promise<string | null> => 'token');
    const storage = createAtomicAuthStorage({ getDel, eval: async () => 1 });
    expect(await storage.getAndDelete('verification:123')).toBe('token');
    expect(getDel).toHaveBeenCalledWith('verification:123');
  });

  it('increments with an expiry in one command and normalizes the Redis result', async () => {
    const evalScript = mock(async (_script: string, _options: unknown) => '2');
    const storage = createAtomicAuthStorage({ getDel: async () => null, eval: evalScript });
    expect(await storage.increment('rate:123', 60.2)).toBe(2);
    expect(evalScript).toHaveBeenCalledTimes(1);
    expect(evalScript.mock.calls[0][1]).toEqual({ keys: ['rate:123'], arguments: ['61'] });
  });

  it('does not suppress Redis failures for security-sensitive atomic operations', async () => {
    const unavailable = async () => {
      throw new Error('Redis unavailable');
    };
    const storage = createAtomicAuthStorage({ getDel: unavailable, eval: unavailable });
    await expect(storage.getAndDelete('verification:123')).rejects.toThrow('Redis unavailable');
    await expect(storage.increment('rate:123', 60)).rejects.toThrow('Redis unavailable');
  });
});
