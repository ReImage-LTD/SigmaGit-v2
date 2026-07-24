import { describe, expect, it } from 'bun:test';
import {
  guardedFetch,
  isBlockedAddress,
  isBlockedIpv4,
  isBlockedIpv6,
  outboundUrlError,
  resolveAndValidateOutbound,
  validateOutboundUrl,
} from '../../security/ssrf';

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

  it('rejects private IPv4 ranges and numeric variants', () => {
    expect(validateOutboundUrl('http://127.0.0.1/').ok).toBe(false);
    expect(validateOutboundUrl('http://10.0.0.5/').ok).toBe(false);
    expect(validateOutboundUrl('http://192.168.1.1/').ok).toBe(false);
    expect(validateOutboundUrl('http://172.16.0.1/').ok).toBe(false);
    expect(validateOutboundUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(validateOutboundUrl('http://0.0.0.0/').ok).toBe(false);
    expect(isBlockedIpv4('100.64.0.1')).toBe(true);
  });

  it('rejects loopback and link-local IPv6 and mapped IPv4', () => {
    expect(validateOutboundUrl('http://[::1]/').ok).toBe(false);
    expect(validateOutboundUrl('http://[fe80::1]/').ok).toBe(false);
    expect(validateOutboundUrl('http://[fc00::1]/').ok).toBe(false);
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIpv6('::ffff:7f00:1')).toBe(true);
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
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

describe('resolveAndValidateOutbound', () => {
  it('rejects when any DNS answer is private (mixed public/private)', async () => {
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    const r = await resolveAndValidateOutbound('https://evil.example/', {}, lookup as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('blocked address');
  });

  it('accepts all-public DNS answers', async () => {
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ];
    const r = await resolveAndValidateOutbound('https://example.com/', {}, lookup as any);
    expect(r.ok).toBe(true);
    expect(r.addresses?.length).toBe(2);
  });

  it('rejects pure private DNS answers', async () => {
    const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    const r = await resolveAndValidateOutbound('https://loop.example/', {}, lookup as any);
    expect(r.ok).toBe(false);
  });

  it('validates literal IPs without DNS', async () => {
    const r = await resolveAndValidateOutbound('https://8.8.8.8/');
    expect(r.ok).toBe(true);
    const bad = await resolveAndValidateOutbound('https://127.0.0.1/');
    expect(bad.ok).toBe(false);
  });
});

describe('guardedFetch redirects', () => {
  it('re-validates redirect destinations and blocks private hops', async () => {
    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
    // First hop public, Location points to metadata IP
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (_url: any, _init?: any) => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://169.254.169.254/latest/meta-data' },
        });
      }
      return new Response('ok', { status: 200 });
    }) as any;

    try {
      await expect(
        guardedFetch('https://example.com/start', {
          lookup: publicLookup as any,
          pinAddress: false,
          requireHttps: false,
        })
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects redirect rebinding to private DNS', async () => {
    let host = 'first.example';
    const lookup = async (hostname: string) => {
      if (hostname.includes('first')) {
        return [{ address: '93.184.216.34', family: 4 }];
      }
      return [{ address: '10.1.2.3', family: 4 }];
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://second.example/private' },
      })) as any;

    try {
      await expect(
        guardedFetch(`https://${host}/`, {
          lookup: lookup as any,
          pinAddress: false,
        })
      ).rejects.toThrow(/blocked/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
