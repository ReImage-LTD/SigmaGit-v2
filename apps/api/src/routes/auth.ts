import { Hono } from "hono";
import { eq, and, gt, sql } from "drizzle-orm";
import { getAuth, verifyCredentials } from "../auth";
import { db, users, verifications, accounts, sessions } from "@sigmagit/db";
import { sendPasswordResetEmail, sendVerificationEmail } from "../email";
import { isPasswordCompromised } from "../security/pwned";
import { generateOpaqueToken, hashToken } from "../security/token-hash";
import { validatePassword } from "@sigmagit/lib";
import { logSecurityEvent } from "../security/audit";
import {
  getValidated,
  zValidator,
} from "../middleware/validate";
import { z } from "zod";

const app = new Hono();


const emailBodySchema = z
  .object({
    email: z.string().trim().email().max(254),
  })
  .strict();

const resetPasswordBodySchema = z
  .object({
    token: z.string().min(1).max(512),
    password: z.string().min(8).max(128),
  })
  .strict();

app.post("/api/auth/verify-credentials", async (c) => {
  const response = await verifyCredentials(c.req.raw);
  return response;
});

app.post(
  "/api/auth/forgot-password",
  zValidator("json", emailBodySchema),
  async (c) => {
  try {
    const { email: rawEmail } = getValidated<{ email: string }>(c, "json");
    const email = rawEmail.toLowerCase().trim();

    // Always return success to resist account enumeration.
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      return c.json({ success: true });
    }

    const token = generateOpaqueToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.delete(verifications).where(
      and(eq(verifications.identifier, `password-reset:${email}`))
    );

    await db.insert(verifications).values({
      id: crypto.randomUUID(),
      identifier: `password-reset:${email}`,
      value: tokenHash,
      expiresAt,
    });

    await sendPasswordResetEmail(email, token, user.username);

    logSecurityEvent({
      action: "auth.password_reset",
      actorId: user.id,
      outcome: "success",
      meta: { stage: "requested" },
    });

    return c.json({ success: true });
  } catch (err) {
    console.error("[Auth] Forgot password error:", err);
    return c.json({ error: "Failed to process request" }, 500);
  }
});

app.post(
  "/api/auth/reset-password",
  zValidator("json", resetPasswordBodySchema),
  async (c) => {
  try {
    const { token, password } = getValidated<{ token: string; password: string }>(c, "json");

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.error }, 400);
    }

    if (await isPasswordCompromised(password)) {
      return c.json(
        {
          code: "PASSWORD_COMPROMISED",
          error: "Please choose a more secure password.",
        },
        400
      );
    }

    const tokenHash = hashToken(token);

    // Atomic consume: delete matching hash row and return it.
    const consumed = await db
      .delete(verifications)
      .where(
        and(
          eq(verifications.value, tokenHash),
          gt(verifications.expiresAt, new Date()),
          sql`${verifications.identifier} LIKE 'password-reset:%'`
        )
      )
      .returning();

    const verification = consumed[0];
    if (!verification || !verification.identifier.startsWith("password-reset:")) {
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    const email = verification.identifier.replace("password-reset:", "");

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      // Token already consumed; do not reveal user missing differently.
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    const hashedPassword = await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 12,
    });

    await db
      .update(accounts)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(accounts.userId, user.id));

    // Revoke all sessions after password reset.
    await db.delete(sessions).where(eq(sessions.userId, user.id));

    try {
      const { closeUserConnections } = await import("../websocket");
      closeUserConnections(user.id, "password_reset");
    } catch {
      /* ignore */
    }

    logSecurityEvent({
      action: "auth.password_reset",
      actorId: user.id,
      outcome: "success",
      meta: { stage: "completed" },
    });

    return c.json({ success: true });
  } catch (err) {
    console.error("[Auth] Reset password error:", err);
    return c.json({ error: "Failed to reset password" }, 500);
  }
});

app.post(
  "/api/auth/resend-verification",
  zValidator("json", emailBodySchema),
  async (c) => {
  try {
    const { email: rawEmail } = getValidated<{ email: string }>(c, "json");
    const email = rawEmail.toLowerCase().trim();

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    // Enumeration-resistant success
    if (!user || user.emailVerified) {
      return c.json({ success: true });
    }

    const token = generateOpaqueToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.delete(verifications).where(
      eq(verifications.identifier, `email-verification:${email}`)
    );

    await db.insert(verifications).values({
      id: crypto.randomUUID(),
      identifier: `email-verification:${email}`,
      value: tokenHash,
      expiresAt,
    });

    await sendVerificationEmail(email, token, user.username);

    return c.json({ success: true });
  } catch (err) {
    console.error("[Auth] Resend verification error:", err);
    return c.json({ error: "Failed to send verification email" }, 500);
  }
});

app.get("/api/auth/verify-email", async (c) => {
  try {
    const token = c.req.query("token");

    if (!token) {
      return c.json({ error: "Token is required" }, 400);
    }

    const tokenHash = hashToken(token);

    const consumed = await db
      .delete(verifications)
      .where(
        and(
          eq(verifications.value, tokenHash),
          gt(verifications.expiresAt, new Date()),
          sql`${verifications.identifier} LIKE 'email-verification:%'`
        )
      )
      .returning();

    const verification = consumed[0];
    if (!verification || !verification.identifier.startsWith("email-verification:")) {
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    const email = verification.identifier.replace("email-verification:", "");

    await db
      .update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.email, email));

    logSecurityEvent({
      action: "auth.email_verified",
      outcome: "success",
      meta: { emailDomain: email.split("@")[1] ?? null },
    });

    return c.json({ success: true });
  } catch (err) {
    console.error("[Auth] Verify email error:", err);
    return c.json({ error: "Failed to verify email" }, 500);
  }
});

app.all("/api/auth/*", async (c) => {
  const auth = getAuth();
  const response = await auth.handler(c.req.raw);
  return response;
});

export default app;
