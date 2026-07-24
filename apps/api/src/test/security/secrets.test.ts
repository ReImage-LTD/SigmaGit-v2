import { describe, expect, it } from 'bun:test';
import { isStrongSecret, secureCompare } from '../../security/secrets';

describe('secureCompare', () => {
  it('returns true for equal secrets', () => {
    expect(secureCompare('abc123secret', 'abc123secret')).toBe(true);
  });

  it('returns false for unequal secrets and nulls', () => {
    expect(secureCompare('abc', 'abd')).toBe(false);
    expect(secureCompare('abc', 'abcd')).toBe(false);
    expect(secureCompare(null, 'abc')).toBe(false);
    expect(secureCompare('abc', undefined)).toBe(false);
  });
});

describe('isStrongSecret', () => {
  it('rejects short and placeholder values', () => {
    expect(isStrongSecret('short')).toBe(false);
    expect(isStrongSecret('changeme-changeme-changeme-changeme')).toBe(false);
    expect(isStrongSecret('your-secret-key-here-please-replace!!')).toBe(false);
  });

  it('accepts long random-looking secrets', () => {
    expect(isStrongSecret('a'.repeat(32))).toBe(true);
    expect(isStrongSecret('3334c7a7b753a0cb22b195e41e002ded4c89e9b95eb82976e2eacb0c09826036')).toBe(
      true
    );
  });
});
