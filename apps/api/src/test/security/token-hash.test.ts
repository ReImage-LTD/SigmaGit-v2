import { describe, expect, it } from 'bun:test';
import { generateOpaqueToken, hashToken, verifyTokenHash } from '../../security/token-hash';

describe('token-hash', () => {
  it('generates unique high-entropy tokens', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it('hashes and verifies tokens', () => {
    const token = generateOpaqueToken();
    const h = hashToken(token);
    expect(h).not.toBe(token);
    expect(verifyTokenHash(token, h)).toBe(true);
    expect(verifyTokenHash(token + 'x', h)).toBe(false);
  });
});
