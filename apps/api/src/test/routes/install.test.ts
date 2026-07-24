import { describe, expect, it } from 'bun:test';
import { getInstallLockKey, INSTALL_LOCK_KEY, rowAcquired } from '../../routes/install';

describe('install lock helpers', () => {
  it('exports a stable advisory lock key', () => {
    expect(INSTALL_LOCK_KEY).toBe(882_451_013);
    expect(getInstallLockKey()).toBe(INSTALL_LOCK_KEY);
  });

  it('parses pg_try_advisory_lock row shapes', () => {
    expect(rowAcquired([{ acquired: true }])).toBe(true);
    expect(rowAcquired([{ acquired: false }])).toBe(false);
    expect(rowAcquired([{ acquired: 't' }])).toBe(true);
    expect(rowAcquired([{ acquired: 'f' }])).toBe(false);
    expect(rowAcquired({ rows: [{ acquired: true }] })).toBe(true);
    expect(rowAcquired(null)).toBe(null);
  });
});
