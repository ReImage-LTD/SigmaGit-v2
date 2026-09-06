interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number; NX?: true }): Promise<unknown>;
}
export function createGitCacheGeneration(getClient: () => Promise<CacheClient | null>) {
  let localGitGeneration = 0;
  function gitGenerationKey(owner: string, name: string) {
    return 'sigmagit:git-generation:' + JSON.stringify([owner, name]);
  }

  const repoCache = {
    async key(owner: string, name: string, parts: unknown[]): Promise<string | null> {
      const client = await getClient();
      if (!client) return null;
      try {
        const key = gitGenerationKey(owner, name);
        let generation = await client.get(key);
        if (!generation) {
          // Random generations prevent evicted pointers from reviving old cached data.
          await client.set(key, crypto.randomUUID(), { NX: true, EX: 86400 });
          generation = await client.get(key);
        }
        return generation
          ? 'sigmagit:git-v2:' + JSON.stringify([owner, name, generation, ...parts])
          : null;
      } catch {
        return null;
      }
    },
    flightKey(owner: string, name: string, parts: unknown[]) {
      return JSON.stringify([localGitGeneration, owner, name, ...parts]);
    },
    async invalidateRepo(owner: string, name: string): Promise<void> {
      localGitGeneration++;
      const client = await getClient();
      if (!client) return;
      try {
        await client.set(gitGenerationKey(owner, name), crypto.randomUUID(), { EX: 86400 });
      } catch {
        /* Cache TTL bounds stale data when Redis is unavailable. */
      }
    },
    async invalidateBranch(owner: string, name: string, _branch: string): Promise<void> {
      await repoCache.invalidateRepo(owner, name);
    },
  };

  return repoCache;
}
