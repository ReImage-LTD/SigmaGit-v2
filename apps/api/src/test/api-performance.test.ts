import { createGitCacheGeneration } from '../lib/git-cache-generation';
import { createSingleFlight } from '../lib/single-flight';
import { requestSignal } from '../lib/request-context';
import { mapConcurrent } from '../lib/map-concurrent';
import { describe, expect, it } from 'bun:test';

describe('shared Git loads', () => {
  it('runs one loader and isolates caller cancellation', async () => {
    const run = createSingleFlight();
    let calls = 0;
    let release!: (value: number) => void;
    let sharedSignal: AbortSignal | undefined;
    const load = () => {
      calls++;
      sharedSignal = requestSignal();
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };
    const controller = new AbortController();
    const first = run('key', load, controller.signal);
    const second = run('key', load);
    await Bun.sleep(0);
    controller.abort(new Error('disconnected'));
    await expect(first).rejects.toThrow('disconnected');
    expect(sharedSignal?.aborted).toBe(false);
    release(42);
    expect(await second).toBe(42);
    expect(calls).toBe(1);
  });

  it('cancels abandoned work and allows a replacement load immediately', async () => {
    const run = createSingleFlight();
    const controller = new AbortController();
    let sharedSignal: AbortSignal | undefined;
    const first = run(
      'key',
      () => {
        sharedSignal = requestSignal();
        return new Promise(() => {});
      },
      controller.signal,
    );
    await Bun.sleep(0);
    controller.abort();
    await expect(first).rejects.toThrow();
    expect(sharedSignal?.aborted).toBe(true);
    expect(await run('key', async () => 7)).toBe(7);
  });

  it('cleans up rejected and timed-out loaders', async () => {
    const run = createSingleFlight(2, 10);
    await expect(
      run('key', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    await expect(run('key', () => new Promise(() => {}))).rejects.toThrow('timed out');
    expect(await run('key', async () => 1)).toBe(1);
  });
});

it('invalidates Git keys with one write and never revives evicted generations', async () => {
  const data = new Map<string, string>();
  let writes = 0;
  const cache = createGitCacheGeneration(async () => ({
    get: async (key) => data.get(key) ?? null,
    set: async (key, value, options) => {
      writes++;
      if (!options.NX || !data.has(key)) data.set(key, value);
    },
  }));
  const oldKey = await cache.key('owner', 'repo', ['file', 'main', 'a']);
  const before = writes;
  await cache.invalidateRepo('owner', 'repo');
  expect(writes - before).toBe(1);
  const newKey = await cache.key('owner', 'repo', ['file', 'main', 'a']);
  expect(newKey).not.toBe(oldKey);
  data.clear();
  expect(await cache.key('owner', 'repo', ['file', 'main', 'a'])).not.toBe(newKey);
  expect(await cache.key('owner', 'repo', ['file', 'feature:a', 'b'])).not.toBe(
    await cache.key('owner', 'repo', ['file', 'feature', 'a:b']),
  );
});

it('bounds diff concurrency and preserves file order', async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapConcurrent([4, 3, 2, 1, 0], 2, async (item) => {
    maximum = Math.max(maximum, ++active);
    await Bun.sleep(item);
    active--;
    return item;
  });
  expect(result).toEqual([4, 3, 2, 1, 0]);
  expect(maximum).toBe(2);
});
