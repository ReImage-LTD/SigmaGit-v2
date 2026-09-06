import { createGitCacheGeneration } from './lib/git-cache-generation';
import { createRecoveringConnection } from './lib/recovering-connection';
import { createClient, type RedisClientType } from 'redis';
import { config } from './config';

type RedisRole = 'session' | 'cache';

function createPool(role: RedisRole) {
  const pool = createRecoveringConnection<RedisClientType>({
    connect: async () => {
      const client = createClient({
        url: role === 'session' ? config.redisSessionUrl : config.redisCacheUrl,
        disableOfflineQueue: true,
        commandOptions: { timeout: 3000 },
        socket: { connectTimeout: 3000, reconnectStrategy: false },
      }) as RedisClientType;
      client.on('error', () => pool.invalidate(client));
      try {
        await client.connect();
        return client;
      } catch (error) {
        if (client.isOpen) client.destroy();
        console.error(`[Redis:${role}] Connection failed; retrying after backoff`);
        throw error;
      }
    },
    healthy: async (client) => {
      if (!client.isReady) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          client.ping().then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 1000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    dispose: (client) => {
      if (client.isOpen) client.destroy();
    },
  });
  return pool;
}

const pools = { session: createPool('session'), cache: createPool('cache') };
function connectRedis(role: RedisRole): Promise<RedisClientType | null> {
  const url = role === 'session' ? config.redisSessionUrl : config.redisCacheUrl;
  return url ? pools[role].get() : Promise.resolve(null);
}
/** Session/operational Redis — auth sessions, rate limits, challenges. */
export const getRedisSession = (): Promise<RedisClientType | null> => connectRedis('session');

/** Cache Redis — git metadata, API response cache, repo/user lookups. */
export const getRedisCache = (): Promise<RedisClientType | null> => connectRedis('cache');

/** @deprecated Use getRedisSession() */
export const getRedis = getRedisSession;

/** @deprecated Use getRedisSession() */
export const getRedisClient = getRedisSession;

export const initializeRedis = async (): Promise<RedisClientType> => {
  if (!config.redisSessionUrl) {
    throw new Error('REDIS_SESSION_URL (or REDIS_URL) is not configured');
  }

  const client = await getRedisSession();
  if (!client) {
    throw new Error('Failed to connect to Redis session store');
  }

  return client;
};

export const CACHE_TTL = {
  session: 60 * 60,
  gitObject: 60 * 60 * 24,
  refs: 60 * 5,
  branches: 60 * 5,
  tree: 60 * 30,
  file: 60 * 60,
  commits: 60 * 10,
  user: 60 * 5,
  repoSlug: 60 * 5,
  platformStats: 60,
  systemSetting: 30,
  profileResolve: 60 * 2,
  accessFacts: 60,
} as const;

function cacheKey(type: string, ...parts: string[]): string {
  return `sigmagit:${type}:${parts.join(':')}`;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const client = await getRedisCache();
  if (!client) return null;

  try {
    const data = await client.get(key);
    if (data) {
      return JSON.parse(data) as T;
    }
  } catch {
    // ignore cache read errors
  }
  return null;
}

export async function setCache<T>(key: string, value: T, ttl: number): Promise<void> {
  const client = await getRedisCache();
  if (!client) return;

  try {
    await client.set(key, JSON.stringify(value), { EX: ttl });
  } catch {
    // ignore cache write errors
  }
}

export async function deleteCache(key: string): Promise<void> {
  const client = await getRedisCache();
  if (!client) return;

  try {
    await client.del(key);
  } catch {
    // ignore cache delete errors
  }
}

export async function deleteCachePattern(pattern: string): Promise<void> {
  const client = await getRedisCache();
  if (!client) return;

  try {
    let cursor = '0';
    const SCAN_BATCH_SIZE = 100;
    let totalDeleted = 0;

    do {
      const result = await client.scan(cursor, {
        MATCH: pattern,
        COUNT: SCAN_BATCH_SIZE,
      });

      cursor = result.cursor;
      const keys = result.keys;

      if (keys.length > 0) {
        await client.del(keys);
        totalDeleted += keys.length;
      }

      if (cursor === '0') break;
    } while (cursor !== '0');

    if (totalDeleted > 0) {
      console.log(`[Cache] Deleted ${totalDeleted} keys for pattern ${pattern}`);
    }
  } catch (error) {
    console.error('[Cache] Error deleting pattern:', error);
  }
}

export const appCache = {
  userKey: (userId: string) => cacheKey('user', userId),
  repoSlugKey: (ownerSlug: string, repoName: string) =>
    cacheKey('repo-slug', ownerSlug, repoName.replace(/\.git$/, '')),
  platformStatsKey: () => cacheKey('platform-stats'),
  systemSettingKey: (key: string) => cacheKey('system', key),
  profileResolveKey: (username: string) => cacheKey('profile-resolve', username),
  accessKey: (repoId: string, userId: string) => cacheKey('access', repoId, userId),

  async invalidateUser(userId: string): Promise<void> {
    await deleteCache(appCache.userKey(userId));
  },

  async invalidateRepoSlug(ownerSlug: string, repoName: string): Promise<void> {
    await deleteCache(appCache.repoSlugKey(ownerSlug, repoName));
  },

  async invalidatePlatformStats(): Promise<void> {
    await deleteCache(appCache.platformStatsKey());
  },

  async invalidateSystemSetting(key: string): Promise<void> {
    await deleteCache(appCache.systemSettingKey(key));
  },

  async invalidateProfileResolve(username: string): Promise<void> {
    await deleteCache(appCache.profileResolveKey(username));
  },

  /** Invalidate a single user's cached access facts for one repo. */
  async invalidateAccess(repoId: string, userId: string): Promise<void> {
    await deleteCache(appCache.accessKey(repoId, userId));
  },

  /** Invalidate all cached access facts for a repo (e.g. on collaborator changes). */
  async invalidateRepoAccess(repoId: string): Promise<void> {
    await deleteCachePattern(cacheKey('access', repoId, '*'));
  },

  /** Invalidate all cached access facts for a user across repos (org/team membership). */
  async invalidateUserAccess(userId: string): Promise<void> {
    // Keys are access:{repoId}:{userId}
    await deleteCachePattern(cacheKey('access', '*', userId));
  },
};

export const repoCache = createGitCacheGeneration(getRedisCache);
