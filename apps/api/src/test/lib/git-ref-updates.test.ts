import { describe, test, expect } from 'bun:test';
import { applyRefUpdates } from '../../lib/git-ref-updates';
const zero = '0'.repeat(40), a = 'a'.repeat(40), b = 'b'.repeat(40);
function fixture() {
  const refs = new Map<string, string>();
  return { refs, storage: {
    read: async (ref: string) => refs.get(ref) ?? null,
    write: async (ref: string, oid: string) => { refs.set(ref, oid); },
    remove: async (ref: string) => { refs.delete(ref); },
  } };
}
describe('receive-pack ref comparisons', () => {
  test('creation, update and deletion require the current oid', async () => {
    const { refs, storage } = fixture();
    const ref = 'refs/heads/main';
    await applyRefUpdates([{ref, oldOid: zero, newOid: a}], storage);
    await expect(applyRefUpdates([{ref, oldOid: zero, newOid: b}], storage)).rejects.toThrow('Stale');
    await applyRefUpdates([{ref, oldOid: a, newOid: b}], storage);
    await expect(applyRefUpdates([{ref, oldOid: a, newOid: zero}], storage)).rejects.toThrow('Stale');
    expect(refs.get(ref)).toBe(b);
    await applyRefUpdates([{ref, oldOid: b, newOid: zero}], storage);
    expect(refs.has(ref)).toBe(false);
  });
  test('validates every comparison before changing any refs', async () => {
    const { refs, storage } = fixture();
    await expect(applyRefUpdates([
      {ref: 'refs/heads/new', oldOid: zero, newOid: a},
      {ref: 'refs/heads/stale', oldOid: a, newOid: b},
    ], storage)).rejects.toThrow('Stale');
    expect(refs.size).toBe(0);
  });
  test('rejects unsafe paths and duplicate commands', async () => {
    const { storage } = fixture();
    for (const ref of ['refs/heads/../HEAD', 'refs/heads/a.lock', 'HEAD', 'refs/heads/a b', 'refs/heads/a\\b']) {
      await expect(applyRefUpdates([{ref, oldOid: zero, newOid: a}], storage)).rejects.toThrow('Invalid');
    }
    const update = {ref: 'refs/heads/main', oldOid: zero, newOid: a};
    await expect(applyRefUpdates([update, update], storage)).rejects.toThrow('duplicate');
  });
});
