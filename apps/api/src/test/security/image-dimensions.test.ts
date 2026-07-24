import { describe, expect, it } from 'bun:test';
import {
  AVATAR_MAX_DIMENSION,
  dimensionsWithinAvatarLimits,
  readImageDimensions,
} from '../../security/image-dimensions';

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR length + type placeholders then width/height at 16
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

describe('readImageDimensions', () => {
  it('reads PNG dimensions', () => {
    const d = readImageDimensions(png(128, 64), 'image/png');
    expect(d).toEqual({ width: 128, height: 64 });
  });

  it('enforces avatar dimension limits', () => {
    expect(dimensionsWithinAvatarLimits({ width: 100, height: 100 })).toBe(true);
    expect(dimensionsWithinAvatarLimits({ width: AVATAR_MAX_DIMENSION + 1, height: 10 })).toBe(
      false
    );
    expect(dimensionsWithinAvatarLimits({ width: 0, height: 10 })).toBe(false);
  });
});
