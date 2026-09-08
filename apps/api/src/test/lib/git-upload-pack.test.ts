import { createUploadPackStream, type PackObject } from '../../lib/git-upload-pack';
import { inflateWithConsumedBytes } from '../../lib/async-zlib';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function* objects(): AsyncGenerator<PackObject> {
  yield { type: 'blob', data: Buffer.from('hello') };
  yield { type: 'blob', data: Buffer.alloc(100_000, 65) };
}

describe('upload pack spool', () => {
  test('emits valid headers, objects and checksum and removes its spool', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pack-test-'));
    try {
      const stream = await createUploadPackStream(objects(), {
        maxBytes: 200_000,
        maxObjects: 2,
        tempDirectory: directory,
      });
      const response = Buffer.from(await new Response(stream).arrayBuffer());
      expect(response.subarray(0, 8).toString()).toBe('0008NAK\n');
      const pack = response.subarray(8);
      expect(pack.subarray(0, 4).toString()).toBe('PACK');
      expect(pack.readUInt32BE(4)).toBe(2);
      expect(pack.readUInt32BE(8)).toBe(2);
      expect(pack.subarray(-20)).toEqual(createHash('sha1').update(pack.subarray(0, -20)).digest());
      expect(pack[12]).toBe(0x35);
      const first = await inflateWithConsumedBytes(pack, 13, 5);
      expect(first.data.toString()).toBe('hello');
      let offset = 13 + first.bytesRead;
      while (pack[offset++] & 128) {
        /* skip variable length object header */
      }
      const second = await inflateWithConsumedBytes(pack, offset, 100_000);
      expect(second.data).toEqual(Buffer.alloc(100_000, 65));
      expect(offset + second.bytesRead).toBe(pack.length - 20);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('cleans up on budget failure, source failure, cancellation and abort', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pack-test-'));
    const options = { maxBytes: 200_000, maxObjects: 2, tempDirectory: directory };
    try {
      await expect(createUploadPackStream(objects(), { ...options, maxBytes: 10 })).rejects.toThrow(
        'budget',
      );
      await expect(
        createUploadPackStream(objects(), { ...options, maxObjects: 1 }),
      ).rejects.toThrow('budget');
      async function* broken(): AsyncGenerator<PackObject> {
        throw new Error('missing object');
      }
      await expect(createUploadPackStream(broken(), options)).rejects.toThrow('missing object');
      const stream = await createUploadPackStream(objects(), options);
      await stream.cancel();
      const controller = new AbortController();
      controller.abort();
      await expect(
        createUploadPackStream(objects(), { ...options, signal: controller.signal }),
      ).rejects.toThrow();
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
