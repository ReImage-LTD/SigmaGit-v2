import { describe, expect, it } from 'bun:test';
import {
  AVATAR_MAX_BYTES,
  detectImageMime,
  validateAvatarUpload,
  avatarExtensionForMime,
} from '../../security/avatar';

function pngBytes(size = 100, width = 32, height = 32): Uint8Array {
  // Minimal PNG signature + IHDR width/height at offset 16
  const bytes = new Uint8Array(Math.max(size, 32));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function jpegBytes(size = 100): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

function gifBytes(): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  return bytes;
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

describe('detectImageMime', () => {
  it('detects PNG/JPEG/GIF/WebP', () => {
    expect(detectImageMime(pngBytes())).toBe('image/png');
    expect(detectImageMime(jpegBytes())).toBe('image/jpeg');
    expect(detectImageMime(gifBytes())).toBe('image/gif');
    expect(detectImageMime(webpBytes())).toBe('image/webp');
  });

  it('rejects SVG/HTML/scriptable content', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(detectImageMime(svg)).toBeNull();
    const html = new TextEncoder().encode('<!DOCTYPE html><html><script>alert(1)</script>');
    expect(detectImageMime(html)).toBeNull();
  });
});

describe('validateAvatarUpload', () => {
  it('accepts valid PNG with matching MIME', () => {
    const r = validateAvatarUpload(pngBytes(), 'image/png');
    expect(r.ok).toBe(true);
    expect(r.extension).toBe('png');
    expect(r.mime).toBe('image/png');
  });

  it('rejects declared MIME mismatch', () => {
    const r = validateAvatarUpload(pngBytes(), 'image/jpeg');
    expect(r.ok).toBe(false);
  });

  it('rejects SVG even if declared as image/png', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const r = validateAvatarUpload(svg, 'image/png');
    expect(r.ok).toBe(false);
  });

  it('rejects oversized files', () => {
    const big = pngBytes(AVATAR_MAX_BYTES + 10);
    const r = validateAvatarUpload(big, 'image/png');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('5MB');
  });

  it('rejects disallowed MIME types like image/svg+xml', () => {
    const r = validateAvatarUpload(pngBytes(), 'image/svg+xml');
    expect(r.ok).toBe(false);
  });

  it('maps mime to safe extension', () => {
    expect(avatarExtensionForMime('image/jpeg')).toBe('jpg');
    expect(avatarExtensionForMime('image/png')).toBe('png');
  });
});
