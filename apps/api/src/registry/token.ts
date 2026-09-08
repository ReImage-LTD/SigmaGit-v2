import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

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

