import { createObjectReadCache, isImmutableGitObject } from '../../lib/object-read-cache';
import { requestContext, requestSignal } from '../../lib/request-context';
import { expect, test } from 'bun:test';

const key = (name: string) => `repos/owner/repo/objects/aa/${name.repeat(38)}`;

test('shares immutable reads and isolates mutable buffers and refs', async () => {
  const cache = createObjectReadCache();
  let calls = 0;
  const load = async () => {
    calls++;
    await Bun.sleep(1);
    return Buffer.from('abc');
  };
  const [a, b] = await Promise.all([cache.get(key('a'), load), cache.get(key('a'), load)]);
  a![0] = 0;
  expect(b!.toString()).toBe('abc');
  expect((await cache.get(key('a'), load))!.toString()).toBe('abc');
  expect(calls).toBe(1);
  for (const path of ['HEAD', 'refs/heads/main', 'packed-refs', 'config']) {
    const name = `repos/owner/repo/${path}`;
    expect(isImmutableGitObject(name)).toBe(false);
    await cache.get(name, load);
    await cache.get(name, load);
  }
  expect(calls).toBe(9);
});

test('bounds bytes and entries, expires values and skips oversized objects', async () => {
  const cache = createObjectReadCache({ maxBytes: 6, maxEntries: 2, maxObjectBytes: 4, ttlMs: 5 });
  for (const id of ['a', 'b', 'c']) await cache.get(key(id), async () => Buffer.from('abc'));
  expect(cache.stats()).toEqual({ bytes: 6, entries: 2 });
  await cache.get(key('d'), async () => Buffer.alloc(5));
  expect(cache.stats()).toEqual({ bytes: 6, entries: 2 });
  await Bun.sleep(10);
  expect((await cache.get(key('c'), async () => Buffer.from('new')))!.toString()).toBe('new');
});

test('invalidation prevents stale in-flight publication and respects repository boundaries', async () => {
  const cache = createObjectReadCache();
  let release!: (value: Buffer) => void;
  const old = cache.get(
    key('a'),
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await Bun.sleep(0);
  await cache.get(key('b').replace('/repo/', '/repo-backup/'), async () => Buffer.from('backup'));
  cache.invalidate('repos/owner/repo', true);
  expect((await cache.get(key('a'), async () => Buffer.from('new')))!.toString()).toBe('new');
  release(Buffer.from('old'));
  await old;
  expect((await cache.get(key('a'), async () => Buffer.from('wrong')))!.toString()).toBe('new');
  expect(cache.stats().entries).toBe(2);
});

test('one aborted caller does not cancel another caller or poison the cache', async () => {
  const cache = createObjectReadCache();
  const controller = new AbortController();
  let release!: (value: Buffer) => void;
  let sharedSignal: AbortSignal | undefined;
  const load = () => {
    sharedSignal = requestSignal();
    return new Promise<Buffer>((resolve) => {
      release = resolve;
    });
  };
  const a = requestContext.run(controller.signal, () => cache.get(key('a'), load));
  const b = cache.get(key('a'), load);
  await Bun.sleep(0);
  controller.abort();
  await expect(a).rejects.toThrow();
  expect(sharedSignal?.aborted).toBe(false);
  release(Buffer.from('ok'));
  expect((await b)!.toString()).toBe('ok');
});
