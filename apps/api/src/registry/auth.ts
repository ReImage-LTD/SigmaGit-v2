/**
 * OCI Distribution v2 registry authentication.
 * - Token endpoint: validates Basic auth (username + password or API key), returns JWT.
 * - Middleware: validates Bearer token and sets registry claims for scope-based access.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { db, users, organizations, organizationMembers } from "@sigmagit/db";
import { eq, and } from "drizzle-orm";
import { getAuth } from "../auth";
import type { AuthUser } from "../middleware/auth";
import { config } from "../config";

const REGISTRY_TOKEN_TTL_SEC = 15 * 60; // 15 minutes

export type RegistryClaims = {
  sub: string;       // user id
  username: string;
  access: ("pull" | "push")[];
  repo: string;      // "owner/image"
};

function base64UrlEncode(data: Buffer): string {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  return Buffer.from(b64, "base64");
}

function signPayload(header: string, payload: string, secret: string): string {
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return base64UrlEncode(sig);
}

export function issueRegistryToken(claims: Omit<RegistryClaims, "access"> & { access: string[] }): string {
  const secret = config.registryJwtSecret;
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const exp = Math.floor(Date.now() / 1000) + REGISTRY_TOKEN_TTL_SEC;
  const payload = base64UrlEncode(
    Buffer.from(JSON.stringify({ ...claims, exp }))
  );
  const signature = signPayload(header, payload, secret);
  return `${header}.${payload}.${signature}`;
}

export function verifyRegistryToken(token: string): RegistryClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const secret = config.registryJwtSecret;
    const expectedSig = signPayload(headerB64, payloadB64, secret);
    const sigBuf = base64UrlDecode(sigB64);
    const expectedBuf = base64UrlDecode(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const payloadJson = base64UrlDecode(payloadB64).toString("utf8");
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (payload == null || typeof payload !== "object") return null;
    const sub = payload.sub;
    const username = payload.username;
    const access = payload.access;
    const repo = payload.repo;
    const exp = payload.exp;
    if (typeof sub !== "string" || sub.trim() === "") return null;
    if (typeof username !== "string" || username.trim() === "") return null;
    if (typeof repo !== "string" || repo.trim() === "") return null;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    if (!Array.isArray(access)) return null;
    const accessList = access.every((a): a is string => typeof a === "string")
      ? (access.filter((a) => a === "pull" || a === "push") as ("pull" | "push")[])
      : [];
    return {
      sub: sub.trim(),
      username: username.trim(),
      access: accessList,
      repo: repo.trim(),
    };
  } catch {
    return null;
  }
}

/** Resolve Basic auth to AuthUser (username+password or username+API key). */
export async function resolveRegistryBasicAuth(authHeader: string | undefined): Promise<AuthUser | null> {
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
    const tokenResult: { valid?: boolean; key?: { userId: string } } = await (auth.api as any).verifyApiKey?.({
      body: { key: password },
      headers: new Headers(),
    });
    if (tokenResult?.valid && tokenResult?.key?.userId) {
      const [u] = await db.select({ id: users.id, name: users.name, email: users.email, username: users.username, avatarUrl: users.avatarUrl })
        .from(users).where(eq(users.id, tokenResult.key.userId)).limit(1);
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
