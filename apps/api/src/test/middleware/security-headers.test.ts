import { describe, expect, it } from 'bun:test';
import { buildSecurityHeaders } from '../../middleware/security-headers';

describe('buildSecurityHeaders', () => {
  it('includes baseline hardening headers', () => {
    const h = buildSecurityHeaders(false);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Content-Security-Policy']).toContain("default-src 'none'");
    expect(h['Strict-Transport-Security']).toBeUndefined();
  });

  it('adds HSTS in production', () => {
    const h = buildSecurityHeaders(true);
    expect(h['Strict-Transport-Security']).toContain('max-age=31536000');
  });
});
