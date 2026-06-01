import { Hono } from "hono";
import { sql, eq } from "drizzle-orm";
import { db, users } from "@sigmagit/db";
import { validateUsername, validatePassword, isValidEmail } from "@sigmagit/lib";
import { getAuth } from "../auth";

const app = new Hono();

// First-run install: create the initial admin account.
// Public endpoint, but only works while the instance has zero users.
app.post("/api/install", async (c) => {
  // Gate: only allow installation on a brand-new instance.
  const [userCountRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(users);
  if (Number(userCountRow?.count ?? 0) > 0) {
    return c.json({ error: "Instance already initialized" }, 409);
  }

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

  // Create the account through Better Auth so password hashing and the account
  // record match the normal email/password login path. The domain restriction is
  // automatically skipped for the first user (see auth.ts databaseHooks).
  const auth = getAuth();
  // `username` is a custom additional field; extract to a variable so it isn't
  // rejected by the object-literal excess-property check on signUpEmail's body.
  const signUpBody = { email, password: password as string, name, username };
  try {
    await auth.api.signUpEmail({ body: signUpBody });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create admin account";
    return c.json({ error: message }, 400);
  }

  // Promote the freshly created account to admin.
  await db
    .update(users)
    .set({ role: "admin", updatedAt: new Date() })
    .where(eq(users.email, email));

  return c.json({ success: true });
});

export default app;
