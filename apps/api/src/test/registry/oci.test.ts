import {
  assertSafeRegistryKey,
  isValidManifestRef,
  isValidOciDigest,
  isValidOciOwner,
  isValidUploadUuid,
  parseAndValidateImageName,
} from '../../registry/oci';
import { getRegistryBlobKey, getRegistryManifestKey, parseImageName } from '../../registry/storage';
import { describe, expect, it } from 'bun:test';

describe('OCI name validation', () => {
  it('accepts valid owner/image', () => {
    expect(parseAndValidateImageName('alice/my-app')).toEqual({
      owner: 'alice',
      imageName: 'my-app',
    });
    expect(parseImageName('alice/my-app/sub')).toEqual({
      owner: 'alice',
      imageName: 'my-app/sub',
    });
  });

  it('rejects path traversal and invalid names', () => {
    expect(parseAndValidateImageName('../etc/passwd')).toBeNull();
    expect(parseAndValidateImageName('alice/../bob')).toBeNull();
    expect(parseAndValidateImageName('Alice/App')).toBeNull();
    expect(parseAndValidateImageName('alice')).toBeNull();
    expect(isValidOciOwner('..')).toBe(false);
    expect(isValidOciOwner('alice/bob')).toBe(false);
  });

  it('validates digests and tags', () => {
    expect(isValidOciDigest('sha256:' + 'a'.repeat(64))).toBe(true);
    expect(isValidOciDigest('sha256:../x')).toBe(false);
    expect(isValidManifestRef('latest')).toBe(true);
    expect(isValidManifestRef('../x')).toBe(false);
    expect(isValidUploadUuid('00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(isValidUploadUuid('../x')).toBe(false);
  });

  it('builds safe storage keys and rejects bad components', () => {
    const digest = 'sha256:' + 'ab'.repeat(32);
    const key = getRegistryBlobKey('alice', 'my-app', digest);
    expect(key.startsWith('registry/alice/my-app/blobs/sha256/')).toBe(true);
    expect(() => getRegistryBlobKey('alice', '../x', digest)).toThrow();
    expect(() => getRegistryManifestKey('alice', 'app', '../../x')).toThrow();
    expect(assertSafeRegistryKey('registry/a/b')).toBe('registry/a/b');
    expect(() => assertSafeRegistryKey('registry/../etc/passwd')).toThrow();
    expect(() => assertSafeRegistryKey('other/path')).toThrow();
  });
});
