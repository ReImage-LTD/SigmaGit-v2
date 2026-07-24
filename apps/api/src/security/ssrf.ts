/**
 * Outbound URL validation to mitigate SSRF.
 * Blocks private/link-local/metadata destinations and non-HTTP(S) schemes.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

/** IPv4 private / reserved ranges that must not be reached outbound. */
function isBlockedIpv4(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  const octets = m.slice(1).map((p) => parseInt(p, 10));
  if (octets.some((o) => o > 255)) return true;

  const [a, b] = octets;
  // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, 192.0.0/24, 192.0.2/24, 198.18/15, 198.51.100/24, 203.0.113/24, 224+/4, 240+/4
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

function isBlockedIpv6(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true;
  // Unique local fc00::/7, link-local fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true;
  }
  // IPv4-mapped ::ffff:x.x.x.x
  const mapped = h.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped && isBlockedIpv4(mapped[1])) return true;
  return false;
}

export interface OutboundUrlValidation {
  ok: boolean;
  error?: string;
  url?: URL;
}

/**
 * Validate a user-controlled URL before server-side fetch/clone.
 * @param requireHttps - when true (production), only https is allowed
 */
export function validateOutboundUrl(
  raw: string,
  options: { requireHttps?: boolean; allowHttpLocalhost?: boolean } = {}
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

  // Block dotted trailing localhost variants and .local / .internal
  if (
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localdomain')
  ) {
    return { ok: false, error: 'URL targets a blocked host' };
  }

  if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) {
    return { ok: false, error: 'URL targets a private or reserved address' };
  }

  // Reject credentials embedded in URL (user:pass@host)
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL must not contain embedded credentials' };
  }

  return { ok: true, url: parsed };
}

/** Convenience: returns error message or null if valid. */
export function outboundUrlError(
  raw: string,
  options?: { requireHttps?: boolean }
): string | null {
  const result = validateOutboundUrl(raw, options);
  return result.ok ? null : (result.error ?? 'Invalid URL');
}
