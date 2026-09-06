import { expect, it } from 'bun:test';
import { createMemoryPressure, memoryBudgetBytes } from '../lib/memory-pressure';

it('validates the configured RSS budget and rejects unusable limits', () => {
  expect(memoryBudgetBytes()).toBe(1024 * 1024 * 1024);
  expect(memoryBudgetBytes('512')).toBe(512 * 1024 * 1024);
  for (const value of ['', '0', '-1', 'NaN', '1e3', '32', '512MB', '999999999999999999']) {
    expect(() => memoryBudgetBytes(value)).toThrow('API_MEMORY_BUDGET_MB');
  }
});

it('rejects high RSS and only resumes after recovering sufficient headroom', () => {
  const pressure = createMemoryPressure(1000);
  expect(pressure.shouldReject(100)).toBe(false);
  expect(pressure.shouldReject(920)).toBe(true);
  expect(pressure.shouldReject(900)).toBe(true);
  expect(pressure.shouldReject(850)).toBe(true);
  expect(pressure.shouldReject(849)).toBe(false);
  expect(pressure.shouldReject(900)).toBe(false);
});

it('does not force collection at normal RSS or repeatedly during sustained pressure', () => {
  let now = 0;
  const pressure = createMemoryPressure(1000, () => now);
  expect(pressure.shouldCollect(100)).toBe(false);
  expect(pressure.shouldCollect(950)).toBe(true);
  for (now = 1; now < 60_000; now += 1000) expect(pressure.shouldCollect(990)).toBe(false);
  expect(pressure.shouldCollect(950)).toBe(true);
});
