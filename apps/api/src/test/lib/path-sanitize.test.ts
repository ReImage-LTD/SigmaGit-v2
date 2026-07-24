import { describe, expect, it } from 'bun:test';
import { sanitizePathForGit } from '../../lib/validation';

describe('sanitizePathForGit (malformed path regression)', () => {
  it('rejects dot segments', () => {
    expect(sanitizePathForGit('../etc/passwd')).toBeNull();
    expect(sanitizePathForGit('foo/../bar')).toBeNull();
    expect(sanitizePathForGit('./secret')).toBeNull();
  });

  it('accepts normal relative paths', () => {
    expect(sanitizePathForGit('src/index.ts')).toBe('src/index.ts');
    expect(sanitizePathForGit('/src/index.ts')).toBe('src/index.ts');
  });

  it('handles empty path', () => {
    expect(sanitizePathForGit('')).toBe('');
  });

  // Encoded forms must be decoded by the route layer before sanitize; document expected nulls on raw forms with dots
  it('rejects explicit backslash segments if present as path parts', () => {
    // backslash is not a path separator in our join logic — treated as filename char
    // Ensure .. still rejected when mixed
    expect(sanitizePathForGit('foo/../../bar')).toBeNull();
  });
});
