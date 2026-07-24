/**
 * Strict OCI Distribution path component validation.
 * Prevents path traversal and namespace escape in registry storage keys.
 */

/** OCI name component: lowercase alphanumerics, separators (., _, -, --) between alphanumerics */
const OCI_NAME_COMPONENT =
  /^(?:[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/;

/** Tag: max 128, alphanumeric start, then [A-Za-z0-9_.-] */
const OCI_TAG = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;

/** Digest: algorithm:hex */
const OCI_DIGEST = /^(sha256|sha512):[a-f0-9]{32,128}$/i;

/** UUID for upload sessions */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidOciNameComponent(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name.includes('..') || name.includes('\\') || name.includes('\0')) return false;
  return OCI_NAME_COMPONENT.test(name);
}

export function isValidOciOwner(owner: string): boolean {
  if (!owner || owner.length > 128) return false;
  if (owner.includes('/') || owner.includes('..') || owner.includes('\\')) return false;
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(owner);
}

export function isValidOciImageName(imageName: string): boolean {
  return isValidOciNameComponent(imageName);
}

export function isValidOciTag(tag: string): boolean {
  if (!tag || tag.length > 128) return false;
  if (tag.includes('/') || tag.includes('..') || tag.includes('\\')) return false;
  return OCI_TAG.test(tag);
}

export function isValidOciDigest(digest: string): boolean {
  if (!digest || digest.length > 200) return false;
  if (digest.includes('..') || digest.includes('\\') || digest.includes('/')) {
    // digest uses one colon: sha256:hex — no path separators
    // actually digest has colon not slash; reject path chars
  }
  if (digest.includes('..') || digest.includes('\\') || digest.includes('/')) return false;
  return OCI_DIGEST.test(digest);
}

export function isValidUploadUuid(uuid: string): boolean {
  return UUID_RE.test(uuid);
}

export function isValidManifestRef(ref: string): boolean {
  if (!ref || ref.length > 256) return false;
  if (ref.includes('..') || ref.includes('\\') || ref.includes('/')) return false;
  return isValidOciTag(ref) || isValidOciDigest(ref);
}

/**
 * Parse and validate image name "owner/image" (optionally multi-segment image path).
 */
export function parseAndValidateImageName(
  name: string,
): { owner: string; imageName: string } | null {
  if (!name || typeof name !== 'string') return null;
  if (name.includes('..') || name.includes('\\') || name.includes('\0')) return null;
  const parts = name.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const imageName = parts.slice(1).join('/');
  if (!isValidOciOwner(owner)) return null;
  if (!isValidOciImageName(imageName)) return null;
  return { owner, imageName };
}

/**
 * Ensure a storage key stays under the registry prefix and has no path traversal.
 */
export function assertSafeRegistryKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid storage key');
  }
  if (key.includes('..') || key.includes('\\') || key.includes('\0')) {
    throw new Error('Invalid storage key: path traversal');
  }
  if (!key.startsWith('registry/')) {
    throw new Error('Invalid storage key: must be under registry/');
  }
  // Normalize repeated slashes
  const normalized = key.replace(/\/+/g, '/');
  if (normalized !== key || normalized.includes('/../') || normalized.endsWith('/..')) {
    throw new Error('Invalid storage key');
  }
  return normalized;
}
