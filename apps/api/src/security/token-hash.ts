import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Generate a high-entropy opaque token (sent to the user). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash a token for at-rest storage (one-way). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time compare of a raw token against a stored hash. */
export function verifyTokenHash(token: string, storedHash: string): boolean {
  if (!token || !storedHash) return false;
  const a = Buffer.from(hashToken(token), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
