import { Hono } from "hono";
import { sql, eq } from "drizzle-orm";
import { db, users } from "@sigmagit/db";
import { validateUsername, validatePassword, isValidEmail } from "@sigmagit/lib";
import { getAuth } from "../auth";

const app = new Hono();

// Advisory lock key for first-run install (arbitrary stable int64).
export const INSTALL_LOCK_KEY = 882_451_013;

function rowAcquired(result: unknown): boolean | null {
  if (Array.isArray(result) && result[0] && typeof result[0] === "object") {
    const v = (result[0] as { acquired?: boolean | string | number }).acquired;
    if (v === true || v === "t" || v === 1 || v === "true") return true;
    if (v === false || v === "f" || v === 0 || v === "false") return false;
  }
  if (result && typeof result === "object" && "rows" in result) {
    return rowAcquired((result as { rows: unknown }).rows);
  }
  return null;
}

// First-run install: create the initial admin account.
// Public endpoint, but only works while the instance has zero users.
// Uses a PostgreSQL advisory lock so concurrent requests cannot all become admin.
app.post("/api/install", async (c) => {
  let body: { name?: string; username?: string; email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const name = body.name?.trim();
  const username = body.username?.trim().toLowerCase();
  const email = body.email?.trim();
  const password = body.password;

  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }
  if (!email || !isValidEmail(email)) {
    return c.json({ error: "A valid email is required" }, 400);
  }
  if (!username) {
    return c.json({ error: "Username is required" }, 400);
  }
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    return c.json({ error: usernameValidation.error }, 400);
  }
  const passwordValidation = validatePassword(password ?? "");
  if (!passwordValidation.valid) {
    return c.json({ error: passwordValidation.error }, 400);
  }

  // Fast path: already initialized.
  const [earlyCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(users);
  if (Number(earlyCount?.count ?? 0) > 0) {
    return c.json({ error: "Instance already initialized" }, 409);
  }

  // Serialize install attempts. Blocking lock is fine — install is one-time.
  await db.execute(sql`SELECT pg_advisory_lock(${INSTALL_LOCK_KEY})`);

  try {
    const [userCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(users);
    if (Number(userCountRow?.count ?? 0) > 0) {
      return c.json({ error: "Instance already initialized" }, 409);
    }

    const auth = getAuth();
    const signUpBody = { email, password: password as string, name, username };
    try {
      await auth.api.signUpEmail({ body: signUpBody });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create admin account";
      return c.json({ error: message }, 400);
    }

    await db
      .update(users)
      .set({ role: "admin", updatedAt: new Date() })
      .where(eq(users.email, email));

    return c.json({ success: true });
  } finally {
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(${INSTALL_LOCK_KEY})`);
    } catch (err) {
      console.error("[Install] Failed to release advisory lock:", err);
    }
  }
});

// Exported for unit tests of lock key stability.
export function getInstallLockKey(): number {
  return INSTALL_LOCK_KEY;
}

export { rowAcquired };
export default app;
