import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for secrets.
 * Returns false when lengths differ (after hashing both to equal length buffers
 * would still leak length — length mismatch alone is acceptable for secrets).
 */
export function secureCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still perform a compare against itself to keep timing flatter for empty cases.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Minimum secret entropy for production (bytes of random material as hex/base64/utf8 length). */
export const MIN_SECRET_LENGTH = 32;

export function isStrongSecret(value: string | null | undefined, minLen = MIN_SECRET_LENGTH): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < minLen) return false;
  // Reject obvious placeholders
  const lower = value.toLowerCase();
  if (
    lower.includes('changeme') ||
    lower.includes('your-secret') ||
    lower.includes('replace') ||
    lower === 'secret' ||
    lower === 'password'
  ) {
    return false;
  }
  return true;
}
