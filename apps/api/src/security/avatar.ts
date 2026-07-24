/**
 * Avatar upload validation: MIME allowlist, magic-byte checks, safe extensions.
 */

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface AvatarValidationResult {
  ok: boolean;
  error?: string;
  mime?: string;
  extension?: string;
}

function matchesMagic(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

/**
 * Detect image type from magic bytes. Returns null if not a supported image.
 * Does not trust client Content-Type or filename.
 */
export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;

  // JPEG
  if (matchesMagic(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG
  if (matchesMagic(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  // GIF87a / GIF89a
  if (
    matchesMagic(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    matchesMagic(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP
  if (
    matchesMagic(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Validate avatar bytes and optional declared MIME.
 * Rejects SVG, HTML, and other scriptable types by requiring magic-byte match.
 */
export function validateAvatarUpload(
  data: ArrayBuffer | Uint8Array,
  declaredMime?: string | null
): AvatarValidationResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.byteLength === 0) {
    return { ok: false, error: 'Empty file' };
  }

  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return { ok: false, error: 'File size must be less than 5MB' };
  }

  if (declaredMime) {
    const normalized = declaredMime.toLowerCase().split(';')[0]!.trim();
    if (!ALLOWED_MIME.has(normalized)) {
      return {
        ok: false,
        error: 'File must be a JPEG, PNG, GIF, or WebP image',
      };
    }
  }

  const detected = detectImageMime(bytes);
  if (!detected || !ALLOWED_MIME.has(detected)) {
    return {
      ok: false,
      error: 'File content is not a valid JPEG, PNG, GIF, or WebP image',
    };
  }

  if (declaredMime) {
    const normalized = declaredMime.toLowerCase().split(';')[0]!.trim();
    // jpeg aliases
    const declaredCanon =
      normalized === 'image/jpg' ? 'image/jpeg' : normalized;
    if (declaredCanon !== detected) {
      return {
        ok: false,
        error: 'File content does not match declared image type',
      };
    }
  }

  return {
    ok: true,
    mime: detected,
    extension: MIME_TO_EXT[detected],
  };
}

/** Safe storage extension derived from detected MIME only. */
export function avatarExtensionForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? 'png';
}
