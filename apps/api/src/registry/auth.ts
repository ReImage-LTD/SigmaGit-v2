/**
 * OCI Distribution v2 registry authentication.
 * - Token endpoint: validates Basic auth (username + password or API key), returns JWT.
 * - Middleware: validates Bearer token and sets registry claims for scope-based access.
 */

import { db, users, organizations, organizationMembers } from "@sigmagit/db";
import { eq, and } from "drizzle-orm";
import { getAuth } from "../auth";
import type { AuthUser } from "../middleware/auth";

export { issueRegistryToken, verifyRegistryToken, type RegistryClaims } from './token';

/** Resolve Basic auth to AuthUser (username+password or username+API key). */
export async function resolveRegistryBasicAuth(authHeader: string | undefined, beforePassword: () => Promise<Response | undefined>): Promise<AuthUser | Response | null> {
  if (!authHeader || !authHeader.startsWith("Basic ")) return null;
  const token = authHeader.slice("Basic ".length).trim();
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon <= 0) return null;
  const identifier = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  if (!identifier || !password) return null;

  const auth = getAuth();

  // Try API key: identifier = username/email, password = API key
  try {
    const tokenResult: { valid?: boolean; key?: { referenceId: string } } = await (auth.api as any).verifyApiKey?.({
      body: { key: password },
      headers: new Headers(),
    });
    if (tokenResult?.valid && tokenResult?.key?.referenceId) {
      const [u] = await db.select({ id: users.id, name: users.name, email: users.email, username: users.username, avatarUrl: users.avatarUrl })
        .from(users).where(eq(users.id, tokenResult.key.referenceId)).limit(1);
      if (u) {
        const match = identifier.includes("@") ? u.email.toLowerCase() === identifier.toLowerCase() : u.username.toLowerCase() === identifier.toLowerCase();
        if (match) {
          return { id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl };
        }
      }
    }
  } catch {
    // ignore
  }

  const limited = await beforePassword();
  if (limited) return limited;

  // Password auth
  let email = identifier;
  if (!identifier.includes("@")) {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.username, identifier)).limit(1);
    if (!u) return null;
    email = u.email;
  }
  try {
    const result: { user?: AuthUser; session?: { user: AuthUser } } = await (auth.api as any).signInEmail?.({
      body: { email, password, rememberMe: false },
      headers: new Headers(),
    });
    const user = result?.user ?? result?.session?.user ?? null;
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: (user as any).username ?? "",
      avatarUrl: (user as any).image ?? null,
    };
  } catch {
    return null;
  }
}

/** Check if user can push to registry namespace owner/image (owner = username or org name). */
export async function canPushRegistry(user: AuthUser, owner: string, _imageName: string): Promise<boolean> {
  const ownerLower = owner.toLowerCase();
  const [userRow] = await db.select({ id: users.id, username: users.username })
    .from(users).where(eq(users.id, user.id)).limit(1);
  if (userRow?.username?.toLowerCase() === ownerLower) return true;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, ownerLower)).limit(1);
  if (!org) return false;
  const [member] = await db.select().from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, user.id))).limit(1);
  return member != null && (member.role === "owner" || member.role === "admin" || member.role === "member");
}

/** Check if user can pull from registry (same as push for now; can add public repos later). */
export async function canPullRegistry(user: AuthUser, owner: string, _imageName: string): Promise<boolean> {
  return canPushRegistry(user, owner, _imageName);
}
