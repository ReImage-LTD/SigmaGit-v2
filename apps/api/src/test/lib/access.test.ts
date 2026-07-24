import { describe, expect, it } from 'bun:test';
import { evaluateRepoAccessFromFacts } from '../../lib/access';

describe('access permission helpers', () => {
  it('write permission requires write or admin', () => {
    const hasWrite = (permission: string) => permission === 'write' || permission === 'admin';
    expect(hasWrite('read')).toBe(false);
    expect(hasWrite('write')).toBe(true);
    expect(hasWrite('admin')).toBe(true);
  });

  it('evaluateRepoAccessFromFacts is exported for table tests', () => {
    expect(typeof evaluateRepoAccessFromFacts).toBe('function');
  });
});
