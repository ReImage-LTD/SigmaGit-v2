/**
 * Read pixel dimensions from image magic bytes (no decode/re-encode dependency).
 * Used to enforce max dimensions and reject absurd pixel bombs before storage.
 */

export const AVATAR_MAX_DIMENSION = 4096;
export const AVATAR_MIN_DIMENSION = 1;

export interface ImageDimensions {
  width: number;
  height: number;
}

export function readImageDimensions(bytes: Uint8Array, mime: string): ImageDimensions | null {
  try {
    if (mime === 'image/png') return readPng(bytes);
    if (mime === 'image/jpeg') return readJpeg(bytes);
    if (mime === 'image/gif') return readGif(bytes);
    if (mime === 'image/webp') return readWebp(bytes);
  } catch {
    return null;
  }
  return null;
}

function readPng(bytes: Uint8Array): ImageDimensions | null {
  // IHDR starts at offset 16: width(4) height(4)
  if (bytes.length < 24) return null;
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  if (!width || !height) return null;
  return { width, height };
}

function readGif(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) return null;
  const width = bytes[6]! | (bytes[7]! << 8);
  const height = bytes[8]! | (bytes[9]! << 8);
  return { width, height };
}

function readWebp(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  // VP8X
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { width, height };
  }
  // VP8 lossy
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
    if (bytes.length < 30) return null;
    const width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
    const height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff;
    return { width, height };
  }
  return null;
}

function readJpeg(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length - 8) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

export function dimensionsWithinAvatarLimits(dim: ImageDimensions): boolean {
  return (
    dim.width >= AVATAR_MIN_DIMENSION &&
    dim.height >= AVATAR_MIN_DIMENSION &&
    dim.width <= AVATAR_MAX_DIMENSION &&
    dim.height <= AVATAR_MAX_DIMENSION
  );
}
