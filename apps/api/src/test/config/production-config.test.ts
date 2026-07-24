import { describe, expect, it } from 'bun:test';
import { validateProductionEnv } from '../../config';

const baseGood = {
  DATABASE_URL: 'postgres://user:pass@db:5432/sigmagit',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  INTERNAL_API_SECRET: 'b'.repeat(32),
  REGISTRY_JWT_SECRET: 'c'.repeat(32),
  WS_TICKET_SECRET: 'd'.repeat(32),
  API_URL: 'https://api.example.com',
  WEB_URL: 'https://example.com',
  STORAGE_TYPE: 's3',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_BUCKET: 'bucket',
  MIGRATION_CREDENTIALS_KEY: 'e'.repeat(16),
  RUNNER_REGISTRATION_SECRET: 'f'.repeat(16),
};

describe('validateProductionEnv', () => {
  it('accepts a complete production config', () => {
    const r = validateProductionEnv(baseGood);
    expect(r.success).toBe(true);
  });

  it('rejects HTTP production URLs', () => {
    const r = validateProductionEnv({ ...baseGood, API_URL: 'http://api.example.com' });
    expect(r.success).toBe(false);
  });

  it('rejects reused secrets', () => {
    const r = validateProductionEnv({
      ...baseGood,
      INTERNAL_API_SECRET: baseGood.BETTER_AUTH_SECRET,
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing migration key when migrations enabled', () => {
    const r = validateProductionEnv({
      ...baseGood,
      MIGRATION_CREDENTIALS_KEY: '',
      ENABLE_MIGRATIONS: 'true',
    });
    expect(r.success).toBe(false);
  });

  it('rejects weak BETTER_AUTH_SECRET', () => {
    const r = validateProductionEnv({ ...baseGood, BETTER_AUTH_SECRET: 'short' });
    expect(r.success).toBe(false);
  });

  it('rejects missing S3 credentials', () => {
    const r = validateProductionEnv({
      ...baseGood,
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
    });
    expect(r.success).toBe(false);
  });
});
