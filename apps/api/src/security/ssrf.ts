/**
 * Guarded outbound HTTP(S) client with SSRF protections:
 * - scheme/credential checks
 * - DNS A/AAAA resolution of all answers
 * - block loopback/private/link-local/reserved/multicast/metadata/mapped
 * - pin connection to a validated public address (Host + SNI)
 * - disable automatic redirects; re-validate each hop
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { requestSignal } from '../lib/request-context';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const MAX_REDIRECTS = 5;

/** IPv4 private / reserved ranges that must not be reached outbound. */
export function isBlockedIpv4(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  const octets = m.slice(1).map((p) => parseInt(p, 10));
  if (octets.some((o) => o > 255)) return true;

  const [a, b] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

export function isBlockedIpv6(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true;
  }
  // IPv4-mapped ::ffff:x.x.x.x
  const mapped = h.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped && isBlockedIpv4(mapped[1])) return true;
  // Also block ::ffff:7f00:1 style mapped
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    if (isBlockedIpv4(`${a}.${b}.${c}.${d}`)) return true;
  }
  return false;
}

export function isBlockedAddress(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return isBlockedIpv4(addr);
  if (version === 6) return isBlockedIpv6(addr);
  // hostname form
  return isBlockedIpv4(addr) || isBlockedIpv6(addr);
}

export interface OutboundUrlValidation {
  ok: boolean;
  error?: string;
  url?: URL;
}

export function validateOutboundUrl(
  raw: string,
  options: { requireHttps?: boolean } = {}
): OutboundUrlValidation {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'URL is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are allowed' };
  }

  if (options.requireHttps && protocol !== 'https:') {
    return { ok: false, error: 'URL must use HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { ok: false, error: 'URL hostname is required' };
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: 'URL targets a blocked host' };
  }

  if (
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localdomain')
  ) {
    return { ok: false, error: 'URL targets a blocked host' };
  }

  if (isBlockedAddress(hostname)) {
    return { ok: false, error: 'URL targets a private or reserved address' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL must not contain embedded credentials' };
  }

  return { ok: true, url: parsed };
}

export function outboundUrlError(
  raw: string,
  options?: { requireHttps?: boolean }
): string | null {
  const result = validateOutboundUrl(raw, options);
  return result.ok ? null : (result.error ?? 'Invalid URL');
}

export interface ResolveResult {
  ok: boolean;
  error?: string;
  addresses?: string[];
  url?: URL;
}

/**
 * Resolve hostname to A/AAAA and reject if any answer is private/reserved.
 * Literal IPs are validated without DNS.
 */
export async function resolveAndValidateOutbound(
  raw: string,
  options: { requireHttps?: boolean } = {},
  lookup: typeof dns.lookup = dns.lookup
): Promise<ResolveResult> {
  const basic = validateOutboundUrl(raw, options);
  if (!basic.ok || !basic.url) {
    return { ok: false, error: basic.error };
  }

  const hostname = basic.url.hostname;
  const ipVersion = isIP(hostname);
  if (ipVersion) {
    if (isBlockedAddress(hostname)) {
      return { ok: false, error: 'URL targets a private or reserved address' };
    }
    return { ok: true, addresses: [hostname], url: basic.url };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: 'DNS resolution failed' };
  }

  if (!records.length) {
    return { ok: false, error: 'DNS resolution returned no addresses' };
  }

  const addresses = records.map((r) => r.address);
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      return {
        ok: false,
        error: `DNS resolved to a blocked address (${addr})`,
      };
    }
  }

  return { ok: true, addresses, url: basic.url };
}

function formatPinnedHost(ip: string): string {
  return isIP(ip) === 6 ? `[${ip}]` : ip;
}

export interface GuardedFetchOptions extends RequestInit {
  requireHttps?: boolean;
  maxRedirects?: number;
  /** Inject lookup for tests */
  lookup?: typeof dns.lookup;
  /** When true (default), pin request to first public resolved address */
  pinAddress?: boolean;
}

/**
 * Fetch a user-controlled URL with SSRF protections.
 */
export async function guardedFetch(
  rawUrl: string,
  options: GuardedFetchOptions = {}
): Promise<Response> {
  const {
    requireHttps = false,
    maxRedirects = MAX_REDIRECTS,
    lookup = dns.lookup,
    pinAddress = true,
    ...init
  } = options;
  init.signal = requestSignal(init.signal);

  let current = rawUrl;
  let redirects = 0;

  while (true) {
    init.signal?.throwIfAborted();
    const resolved = await resolveAndValidateOutbound(current, { requireHttps }, lookup);
    if (!resolved.ok || !resolved.url || !resolved.addresses?.length) {
      throw new Error(resolved.error || 'Blocked outbound URL');
    }

    const originalHost = resolved.url.hostname;
    let requestUrl = resolved.url.toString();

    if (pinAddress) {
      const pin = resolved.addresses[0]!;
      const host = formatPinnedHost(pin);
      const port = resolved.url.port ? `:${resolved.url.port}` : '';
      requestUrl = `${resolved.url.protocol}//${host}${port}${resolved.url.pathname}${resolved.url.search}${resolved.url.hash}`;
    }

    const headers = new Headers(init.headers);
    if (pinAddress && !headers.has('Host')) {
      headers.set('Host', originalHost + (resolved.url.port ? `:${resolved.url.port}` : ''));
    }

    const fetchInit: RequestInit & { tls?: { serverName: string } } = {
      ...init,
      headers,
      redirect: 'manual',
    };

    // Pin SNI to original hostname when connecting by IP
    if (pinAddress && resolved.url.protocol === 'https:') {
      fetchInit.tls = { serverName: originalHost };
    }

    const response = await fetch(requestUrl, fetchInit);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return response;
      }
      if (redirects >= maxRedirects) {
        throw new Error('Too many redirects');
      }
      // Resolve relative redirects against current URL (logical host, not pin)
      const next = new URL(location, resolved.url).toString();
      redirects += 1;
      current = next;
      // Consume body to free connection
      try {
        await response.arrayBuffer();
      } catch {
        /* ignore */
      }
      continue;
    }

    return response;
  }
}
