import { createGitCacheGeneration } from '../lib/git-cache-generation';
import { createCachedGitLoad } from '../lib/cached-git-load';
import { requestContext } from '../lib/request-context';
import { expect, test } from 'bun:test';

function fixture(enabled = true) {
  const generations = new Map<string, string>();
  const values = new Map<string, unknown>();
  const repoCache = createGitCacheGeneration(async () =>
    enabled
      ? {
          get: async (key) => generations.get(key) ?? null,
          set: async (key, value, options) => {
            if (!options.NX || !generations.has(key)) generations.set(key, value);
          },
        }
      : null,
  );
  const read = createCachedGitLoad({
    repoCache,
    getCached: async <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    setCache: async (key, value) => {
      values.set(key, value);
    },
  });
  return { repoCache, read, values };
}

const store = { ownerId: 'owner', repoName: 'repo' };
const parts = ['file', 'main', 'README.md'];

for (const enabled of [true, false]) {
  test(`invalidation isolates an active read with Redis ${enabled ? 'enabled' : 'disabled'}`, async () => {
    const { repoCache, read } = fixture(enabled);
    const started = Promise.withResolvers<void>();
    const oldData = Promise.withResolvers<string>();
    const oldRead = read(store, parts, 60, () => {
      started.resolve();
      return oldData.promise;
    });
    await started.promise;
    await repoCache.invalidateRepo(store.ownerId, store.repoName);
    expect(await read(store, parts, 60, async () => 'new')).toBe('new');
    oldData.resolve('old');
    expect(await oldRead).toBe('old');
    expect(await read(store, parts, 60, async () => 'new')).toBe('new');
  });
}

test('a loader finishing after its caller disconnects cannot publish to cache', async () => {
  const { read, values } = fixture();
  const started = Promise.withResolvers<void>();
  const data = Promise.withResolvers<string>();
  const caller = new AbortController();
  const result = requestContext.run(caller.signal, () =>
    read(store, parts, 60, () => {
      started.resolve();
      return data.promise;
    }),
  );
  await started.promise;
  caller.abort(new Error('disconnected'));
  await expect(result).rejects.toThrow('disconnected');
  data.resolve('abandoned');
  await Bun.sleep(0);
  expect(values.size).toBe(0);
  expect(await read(store, parts, 60, async () => 'fresh')).toBe('fresh');
});
