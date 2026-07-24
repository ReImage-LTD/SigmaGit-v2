import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const SALT = "sigmagit-migration-credentials-v1";
const VERSION_PREFIX = "v1.";
const MIN_SECRET_LEN = 16;

let keyPromise: Promise<Buffer> | null = null;
let keyError: Error | null = null;

/** Reset cached key state (tests only). */
export function resetCredentialCipherForTests(): void {
  keyPromise = null;
  keyError = null;
}

function missingKeyError(): Error {
  return new Error(
    "MIGRATION_CREDENTIALS_KEY must be set to a secret of at least 16 characters"
  );
}

export function isCredentialKeyConfigured(
  secret: string | undefined | null = process.env.MIGRATION_CREDENTIALS_KEY
): boolean {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LEN;
}

async function getKey(): Promise<Buffer> {
  if (keyError) throw keyError;
  if (keyPromise) return keyPromise;

  keyPromise = (async () => {
    const secret = process.env.MIGRATION_CREDENTIALS_KEY;
    if (!isCredentialKeyConfigured(secret)) {
      const err = missingKeyError();
      keyError = err;
      console.error(
        "[CredentialCipher] MIGRATION_CREDENTIALS_KEY not set or too short; encryption disabled"
      );
      throw err;
    }
    return (await scryptAsync(secret!, SALT, KEY_LEN)) as Buffer;
  })().catch((err) => {
    keyPromise = null;
    throw err;
  });

  return keyPromise;
}

/**
 * Encrypt a credential value for storage. Requires MIGRATION_CREDENTIALS_KEY.
 * Fails closed — never stores reversible base64.
 */
export async function encryptCredential(value: string): Promise<string> {
  const key = await getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, enc]);
  return VERSION_PREFIX + combined.toString("base64");
}

/**
 * Decrypt a stored credential.
 * Accepts "v1." AES-GCM payloads. Legacy base64-only values are rejected
 * unless ALLOW_LEGACY_CREDENTIAL_BASE64=true (temporary migration aid).
 */
export async function decryptCredential(encrypted: string): Promise<string> {
  if (encrypted.startsWith(VERSION_PREFIX)) {
    const key = await getKey();
    const raw = Buffer.from(encrypted.slice(VERSION_PREFIX.length), "base64");
    if (raw.length < IV_LEN + AUTH_TAG_LEN) {
      throw new Error("Invalid encrypted credential payload");
    }
    const iv = raw.subarray(0, IV_LEN);
    const authTag = raw.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
    const ciphertext = raw.subarray(IV_LEN + AUTH_TAG_LEN);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  }

  if (process.env.ALLOW_LEGACY_CREDENTIAL_BASE64 === "true") {
    console.warn(
      "[CredentialCipher] Decrypting legacy base64 credential; re-encrypt at next save"
    );
    return Buffer.from(encrypted, "base64").toString("utf-8");
  }

  throw new Error(
    "Legacy base64 credentials are disabled; set ALLOW_LEGACY_CREDENTIAL_BASE64=true only during migration"
  );
}
