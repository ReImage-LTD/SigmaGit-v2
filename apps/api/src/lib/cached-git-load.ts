import { createGitCacheGeneration } from './git-cache-generation';
import { createSingleFlight } from './single-flight';
import { requestSignal } from './request-context';

interface Dependencies {
  repoCache: ReturnType<typeof createGitCacheGeneration>;
  getCached<T>(key: string): Promise<T | null>;
  setCache<T>(key: string, value: T, ttl: number): Promise<unknown>;
}

export function createCachedGitLoad({ repoCache, getCached, setCache }: Dependencies) {
  const shareGitLoad = createSingleFlight();
  return async function cachedGitLoad<T>(
    store: { ownerId: string; repoName: string },
    parts: unknown[],
    ttl: number,
    load: () => Promise<T>,
    cacheable: (value: T) => boolean = () => true,
  ): Promise<T> {
    const key = await repoCache.key(store.ownerId, store.repoName, parts);
    const flightKey = key ?? repoCache.flightKey(store.ownerId, store.repoName, parts);
    return shareGitLoad(
      flightKey,
      async () => {
        if (key) {
          const cached = await getCached<T>(key);
          if (cached !== null) return cached;
        }
        const result = await load();
        // Keep the original generation: an old read cannot populate the new cache after a write.
        requestSignal()?.throwIfAborted();
        if (key && result !== null && cacheable(result)) await setCache(key, result, ttl);
        return result;
      },
      requestSignal(),
    );
  };
}
