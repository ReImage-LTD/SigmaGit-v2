import { describe, expect, it } from 'bun:test';
import { outboundUrlError, validateOutboundUrl } from '../../security/ssrf';

describe('validateOutboundUrl', () => {
  it('accepts public https URLs', () => {
    const r = validateOutboundUrl('https://github.com/org/repo.git');
    expect(r.ok).toBe(true);
    expect(r.url?.hostname).toBe('github.com');
  });

  it('rejects empty and invalid URLs', () => {
    expect(validateOutboundUrl('').ok).toBe(false);
    expect(validateOutboundUrl('not a url').ok).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(validateOutboundUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateOutboundUrl('ftp://example.com/a').ok).toBe(false);
    expect(validateOutboundUrl('gopher://example.com').ok).toBe(false);
  });

  it('rejects localhost and .local hostnames', () => {
    expect(validateOutboundUrl('http://localhost/admin').ok).toBe(false);
    expect(validateOutboundUrl('http://foo.localhost/x').ok).toBe(false);
    expect(validateOutboundUrl('http://service.local/x').ok).toBe(false);
    expect(validateOutboundUrl('http://metadata.google.internal/').ok).toBe(false);
  });

  it('rejects private IPv4 ranges', () => {
    expect(validateOutboundUrl('http://127.0.0.1/').ok).toBe(false);
    expect(validateOutboundUrl('http://10.0.0.5/').ok).toBe(false);
    expect(validateOutboundUrl('http://192.168.1.1/').ok).toBe(false);
    expect(validateOutboundUrl('http://172.16.0.1/').ok).toBe(false);
    expect(validateOutboundUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(validateOutboundUrl('http://0.0.0.0/').ok).toBe(false);
  });

  it('rejects loopback and link-local IPv6', () => {
    expect(validateOutboundUrl('http://[::1]/').ok).toBe(false);
    expect(validateOutboundUrl('http://[fe80::1]/').ok).toBe(false);
    expect(validateOutboundUrl('http://[fc00::1]/').ok).toBe(false);
  });

  it('rejects embedded credentials', () => {
    expect(validateOutboundUrl('https://user:pass@example.com/a').ok).toBe(false);
  });

  it('enforces HTTPS when requireHttps is true', () => {
    expect(validateOutboundUrl('http://example.com/a', { requireHttps: true }).ok).toBe(false);
    expect(validateOutboundUrl('https://example.com/a', { requireHttps: true }).ok).toBe(true);
  });

  it('outboundUrlError returns null for valid URLs', () => {
    expect(outboundUrlError('https://example.com')).toBeNull();
    expect(outboundUrlError('http://127.0.0.1')).toBeTruthy();
  });
});
