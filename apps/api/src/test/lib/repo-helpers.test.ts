import { describe, expect, it } from 'bun:test';
import { getStorageOwnerId } from '../../lib/repo-helpers';

describe('getStorageOwnerId', () => {
  it('returns ownerId for user-owned repos', () => {
    expect(getStorageOwnerId({ ownerId: 'user-1', organizationId: null, storageOwnerId: 'user-1' })).toBe('user-1');
  });

  it('returns organizationId for org-owned repos', () => {
    expect(getStorageOwnerId({ ownerId: 'user-1', organizationId: 'org-1', storageOwnerId: 'org-1' })).toBe('org-1');
  });
});

it('keeps the same object namespace across personal and organization transfers', () => {
  const repository = { ownerId: 'old-owner', organizationId: 'old-org', storageOwnerId: 'permanent-storage' };
  expect(getStorageOwnerId(repository)).toBe('permanent-storage');
  expect(getStorageOwnerId({ ...repository, ownerId: 'new-owner', organizationId: null })).toBe('permanent-storage');
  expect(getStorageOwnerId({ ...repository, organizationId: 'new-org' })).toBe('permanent-storage');
});
