import { and, eq } from 'drizzle-orm';
import { accounts, db } from '@sigmagit/db';

/**
 * Verify a user's credential password. Returns false if no password account.
 */
export async function verifyUserPassword(
  userId: string,
  password: string
): Promise<boolean> {
  if (!password || typeof password !== 'string') return false;

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')),
  });

  if (!account?.password) return false;

  try {
    return await Bun.password.verify(password, account.password);
  } catch {
    return false;
  }
}
