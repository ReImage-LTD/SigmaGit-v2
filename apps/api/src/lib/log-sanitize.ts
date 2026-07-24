/** Redact sensitive query params from logs (token, password, secret, ticket). */
export function sanitizeQueryForLog(query: string): string {
  if (!query) return '';
  try {
    const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
    const sensitive =
      /^(token|password|secret|ticket|auth|authorization|access_token|refresh_token|api_key|apikey)$/i;
    for (const key of [...params.keys()]) {
      if (sensitive.test(key)) {
        params.set(key, '[REDACTED]');
      }
    }
    const s = params.toString();
    return s ? `?${s}` : '';
  } catch {
    return '?[redacted]';
  }
}
