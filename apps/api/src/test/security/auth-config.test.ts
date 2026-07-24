import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static assertions that security-critical config stays locked in source.
 * Avoids booting better-auth / DB in unit tests.
 */
describe('auth security configuration (source)', () => {
  const authSrc = readFileSync(join(import.meta.dir, '../../auth.ts'), 'utf8');

  it('enables origin check (CSRF)', () => {
    expect(authSrc).toContain('disableOriginCheck: false');
    expect(authSrc).not.toMatch(/disableOriginCheck:\s*true/);
  });

  it('requires passkey userVerification', () => {
    expect(authSrc).toContain("userVerification: 'required'");
    expect(authSrc).not.toMatch(/userVerification:\s*'preferred'/);
  });
});

describe('settings security (source)', () => {
  const settingsSrc = readFileSync(join(import.meta.dir, '../../routes/settings.ts'), 'utf8');

  it('requires password for email change and account delete', () => {
    expect(settingsSrc).toContain('updateEmailBodySchema');
    expect(settingsSrc).toContain('deleteAccountBodySchema');
    expect(settingsSrc).toContain('zValidator');
    expect(settingsSrc).toContain('emailVerified: false');
  });

  it('invalidates sessions on password change', () => {
    expect(settingsSrc).toContain('delete(sessions)');
    expect(settingsSrc).toContain('validateAvatarUpload');
  });
});

describe('migrations security (source)', () => {
  const migrationsSrc = readFileSync(join(import.meta.dir, '../../routes/migrations.ts'), 'utf8');

  it('does not expose credentials over HTTP', () => {
    expect(migrationsSrc).not.toContain('/credentials');
    expect(migrationsSrc).toContain('X-Provider-Token');
    expect(migrationsSrc).toContain('validateOutboundUrl');
  });

  it('does not read provider tokens from query strings', () => {
    expect(migrationsSrc).not.toMatch(/c\.req\.query\(['"]token['"]\)/);
  });
});

describe('websocket security (source)', () => {
  const wsSrc = readFileSync(join(import.meta.dir, '../../websocket.ts'), 'utf8');

  it('uses short-lived tickets instead of session tokens in URL', () => {
    expect(wsSrc).toContain('consumeWsTicket');
    expect(wsSrc).toContain('issueWsTicket');
    expect(wsSrc).not.toMatch(/searchParams\.get\(['"]token['"]\)/);
  });
});
