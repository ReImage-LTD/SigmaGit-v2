import { createReadinessProbe } from '../lib/readiness';
import { describe, expect, it } from 'bun:test';

describe('readiness probe', () => {
  it('coalesces concurrent probes and caches a successful result', async () => {
    let calls = 0;
    const probe = createReadinessProbe(async () => {
      calls++;
      await Bun.sleep(10);
    });
    expect(await Promise.all([probe(), probe(), probe()])).toEqual([true, true, true]);
    expect(await probe()).toBe(true);
    expect(calls).toBe(1);
  });

  it('fails closed when a dependency rejects or hangs', async () => {
    expect(
      await createReadinessProbe(async () => {
        throw new Error('offline');
      })(),
    ).toBe(false);
    let calls = 0;
    const probe = createReadinessProbe(() => {
      calls++;
      return new Promise(() => {});
    }, 10);
    expect(await probe()).toBe(false);
    expect(await probe()).toBe(false);
    expect(calls).toBe(1);
  });
});
