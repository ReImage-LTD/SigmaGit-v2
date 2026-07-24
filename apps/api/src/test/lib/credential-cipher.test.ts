import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  decryptCredential,
  encryptCredential,
  isCredentialKeyConfigured,
  resetCredentialCipherForTests,
} from '../../lib/credential-cipher';

describe('credential-cipher', () => {
  const prevKey = process.env.MIGRATION_CREDENTIALS_KEY;
  const prevLegacy = process.env.ALLOW_LEGACY_CREDENTIAL_BASE64;

  beforeEach(() => {
    resetCredentialCipherForTests();
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.MIGRATION_CREDENTIALS_KEY;
    else process.env.MIGRATION_CREDENTIALS_KEY = prevKey;
    if (prevLegacy === undefined) delete process.env.ALLOW_LEGACY_CREDENTIAL_BASE64;
    else process.env.ALLOW_LEGACY_CREDENTIAL_BASE64 = prevLegacy;
    resetCredentialCipherForTests();
  });

  it('detects configured keys', () => {
    expect(isCredentialKeyConfigured(null)).toBe(false);
    expect(isCredentialKeyConfigured('short')).toBe(false);
    expect(isCredentialKeyConfigured('sixteen-chars!!!')).toBe(true);
  });

  it('fails closed when key is missing', async () => {
    delete process.env.MIGRATION_CREDENTIALS_KEY;
    resetCredentialCipherForTests();
    await expect(encryptCredential('secret')).rejects.toThrow(/MIGRATION_CREDENTIALS_KEY/);
  });

  it('round-trips AES-GCM encryption', async () => {
    process.env.MIGRATION_CREDENTIALS_KEY = 'test-migration-key-32bytes!!';
    resetCredentialCipherForTests();
    const enc = await encryptCredential('super-secret-token');
    expect(enc.startsWith('v1.')).toBe(true);
    // Must not be plain base64 of the value
    expect(enc).not.toBe(Buffer.from('super-secret-token', 'utf-8').toString('base64'));
    const dec = await decryptCredential(enc);
    expect(dec).toBe('super-secret-token');
  });

  it('rejects legacy base64 by default', async () => {
    process.env.MIGRATION_CREDENTIALS_KEY = 'test-migration-key-32bytes!!';
    delete process.env.ALLOW_LEGACY_CREDENTIAL_BASE64;
    resetCredentialCipherForTests();
    const legacy = Buffer.from('legacy-token', 'utf-8').toString('base64');
    await expect(decryptCredential(legacy)).rejects.toThrow(/Legacy base64/);
  });

  it('allows legacy base64 when explicitly enabled', async () => {
    process.env.MIGRATION_CREDENTIALS_KEY = 'test-migration-key-32bytes!!';
    process.env.ALLOW_LEGACY_CREDENTIAL_BASE64 = 'true';
    resetCredentialCipherForTests();
    const legacy = Buffer.from('legacy-token', 'utf-8').toString('base64');
    expect(await decryptCredential(legacy)).toBe('legacy-token');
  });
});
