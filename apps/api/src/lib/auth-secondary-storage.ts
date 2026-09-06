interface AtomicRedis {
  getDel(key: string): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

// Keep the increment and initial expiry in one operation. Refreshing the expiry
// on every attempt would turn Better Auth's fixed window into a sliding window.
const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export function createAtomicAuthStorage(redis: AtomicRedis) {
  return {
    getAndDelete: (key: string) => redis.getDel(key),
    increment: async (key: string, ttl: number) => {
      const result = await redis.eval(INCREMENT_WITH_EXPIRY, {
        keys: [key],
        arguments: [String(Math.max(1, Math.ceil(ttl)))],
      });
      return Number(result);
    },
  };
}
