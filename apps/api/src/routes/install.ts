import { getValidated, installBodySchema, zValidator } from '../middleware/validate';
import { validateUsername, validatePassword } from '@sigmagit/lib/validation';
import { isStrongSecret, secureCompare } from '../security/secrets';
import { db, users, accounts } from '@sigmagit/db';
import { hashPassword } from 'better-auth/crypto';
import { config } from '../config';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

const app = new Hono();

// Advisory lock key for first-run install (arbitrary stable int64).
export const INSTALL_LOCK_KEY = 882_451_013;

function rowAcquired(result: unknown): boolean | null {
  if (Array.isArray(result) && result[0] && typeof result[0] === 'object') {
    const v = (result[0] as { acquired?: boolean | string | number }).acquired;
    if (v === true || v === 't' || v === 1 || v === 'true') return true;
    if (v === false || v === 'f' || v === 0 || v === 'false') return false;
  }
  if (result && typeof result === 'object' && 'rows' in result) {
    return rowAcquired((result as { rows: unknown }).rows);
  }
  return null;
}

// First-run install: create the initial admin account.
// Public endpoint, but only works while the instance has zero users.
// Uses a PostgreSQL advisory lock so concurrent requests cannot all become admin.
app.post('/api/install', zValidator('json', installBodySchema), async (c) => {
  if (config.isProduction) {
    const secret = process.env.INSTALLATION_SECRET;
    if (!isStrongSecret(secret)) return c.json({ error: 'Installation is disabled' }, 503);
    if (!secureCompare(c.req.header('authorization'), `Bearer ${secret}`)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }
  const body = getValidated<typeof installBodySchema._output>(c, 'json');

  const name = body.name.trim();
  const username = body.username.trim().toLowerCase();
  const email = body.email.trim();
  const password = body.password;

  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    return c.json({ error: usernameValidation.error }, 400);
  }
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return c.json({ error: passwordValidation.error }, 400);
  }

  const passwordHash = await hashPassword(password);
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${INSTALL_LOCK_KEY})`);
    if ((await tx.select({ id: users.id }).from(users).limit(1)).length) return false;
    const id = crypto.randomUUID();
    await tx
      .insert(users)
      .values({ id, name, username, email: email.toLowerCase(), role: 'admin' });
    await tx.insert(accounts).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: passwordHash,
    });
    return true;
  });
  return created
    ? c.json({ success: true })
    : c.json({ error: 'Instance already initialized' }, 409);
});

// Exported for unit tests of lock key stability.
export function getInstallLockKey(): number {
  return INSTALL_LOCK_KEY;
}

export { rowAcquired };
export default app;
