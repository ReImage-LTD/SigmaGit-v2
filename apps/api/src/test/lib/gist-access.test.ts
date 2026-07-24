import { canReadGist, canWriteGist } from '../../lib/gist-access';
import { describe, expect, it } from 'bun:test';

describe('gist access', () => {
  const owner = { id: 'owner-1' };
  const other = { id: 'other-1' };
  const publicGist = { id: 'g1', ownerId: 'owner-1', visibility: 'public' };
  const secretGist = { id: 'g2', ownerId: 'owner-1', visibility: 'secret' };

  it('allows anyone to read public gists', () => {
    expect(canReadGist(publicGist, null)).toBe(true);
    expect(canReadGist(publicGist, other)).toBe(true);
    expect(canReadGist(publicGist, owner)).toBe(true);
  });

  it('only allows owner to read secret gists', () => {
    expect(canReadGist(secretGist, null)).toBe(false);
    expect(canReadGist(secretGist, other)).toBe(false);
    expect(canReadGist(secretGist, owner)).toBe(true);
  });

  it('only allows owner to write', () => {
    expect(canWriteGist(publicGist, other)).toBe(false);
    expect(canWriteGist(publicGist, owner)).toBe(true);
    expect(canWriteGist(secretGist, other)).toBe(false);
    expect(canWriteGist(null, owner)).toBe(false);
  });
});
