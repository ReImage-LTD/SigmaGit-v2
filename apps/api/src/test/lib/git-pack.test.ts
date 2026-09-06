import { describe, test, expect } from 'bun:test';
import { deflate, inflateWithConsumedBytes } from '../../lib/async-zlib';
import { applyDelta } from '../../lib/git-delta';
describe('bounded pack decoding', () => {
  test('consumes exactly one stream with trailing pack data', async () => {
    const source = Buffer.alloc(64 * 1024, 65);
    const compressed = await deflate(source);
    const input = Buffer.concat([Buffer.from([1, 2]), compressed, await deflate(Buffer.from('next'))]);
    const decoded = await inflateWithConsumedBytes(input, 2, source.length);
    expect(decoded.data.equals(source)).toBe(true);
    expect(decoded.bytesRead).toBe(compressed.length);
  });
  test('rejects oversized output and truncated streams', async () => {
    const compressed = await deflate(Buffer.alloc(1024 * 1024, 65));
    await expect(inflateWithConsumedBytes(compressed, 0, 4096)).rejects.toThrow();
    await expect(inflateWithConsumedBytes(compressed.subarray(0, -2), 0, 2 * 1024 * 1024)).rejects.toThrow();
  });
  test('applies a mixed copy and literal delta', () => {
    const delta = Buffer.from([3, 4, 0x90, 3, 1, 100]);
    expect(applyDelta(Buffer.from('abc'), delta, 4).toString()).toBe('abcd');
    expect(() => applyDelta(Buffer.from('abc'), delta, 3)).toThrow('budget');
  });
  test('rejects inconsistent delta sizes and out of bounds instructions', () => {
    const base = Buffer.from('abc');
    for (const delta of [[2, 3], [3, 3, 0x90, 4], [3, 3, 2, 65], [3, 3, 0], [3, 3, 1, 65]]) {
      expect(() => applyDelta(base, Buffer.from(delta), 10)).toThrow();
    }
  });
});
