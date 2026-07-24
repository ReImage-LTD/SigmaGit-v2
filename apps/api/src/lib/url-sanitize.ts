/**
 * Protocol-sanitize user-supplied profile/org/social/application URLs.
 * Only http(s) allowed; rejects javascript:, data:, etc.
 */

export function sanitizeHttpUrl(
  raw: string | null | undefined,
  options: { requireHttps?: boolean; maxLength?: number } = {},
): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const maxLength = options.maxLength ?? 2048;
  if (trimmed.length > maxLength) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return null;
  }
  if (options.requireHttps && protocol !== 'https:') {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  return parsed.toString();
}

export function isSafeHttpUrl(
  raw: string | null | undefined,
  options?: { requireHttps?: boolean; maxLength?: number },
): boolean {
  return sanitizeHttpUrl(raw, options) != null;
}
