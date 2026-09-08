import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { finalizeUpload } from '../../registry/storage';
import * as storage from '../../storage';
import { createHash } from 'node:crypto';

afterEach(() => mock.restore());
const uuid = '00000000-0000-4000-8000-000000000001';
const data = Array.from({ length: 6 }, (_, i) => Buffer.from(`chunk-${i}`));
const keys = data.map((_, i) => `registry/_uploads/${uuid}/chunks/${i}`);
const digest = createHash('sha256').update(Buffer.concat(data)).digest('hex');

function setup() {
  spyOn(storage, 'getObject').mockResolvedValue(
    Buffer.from(JSON.stringify({ chunks: keys, size: 42 })),
  );
  const reads = spyOn(storage, 'getObjectWithMetadata').mockImplementation(async (key) => {
    const i = keys.indexOf(key);
    return { data: data[i], etag: `etag-${i}` };
  });
  const copies = spyOn(storage, 'copyObject').mockResolvedValue(undefined);
  const writes = spyOn(storage, 'putObject').mockResolvedValue(undefined);
  const deletes = spyOn(storage, 'deletePrefix').mockResolvedValue(undefined);
  return { reads, copies, writes, deletes };
}

test('verifies bytes then copies chunks conditionally with bounded concurrency', async () => {
  const { reads, copies, writes, deletes } = setup();
  let active = 0;
  let maximum = 0;
  copies.mockImplementation(async () => {
    expect(reads).toHaveBeenCalledTimes(6);
    maximum = Math.max(maximum, ++active);
    await Bun.sleep(1);
    active--;
  });
  expect(await finalizeUpload('alice', 'image', uuid, `sha256:${digest}`)).toEqual({ ok: true });
  expect(maximum).toBe(4);
  for (let i = 0; i < 6; i++) {
    expect(copies.mock.calls[i]).toEqual([
      keys[i],
      `registry/alice/image/blob-chunks/sha256/${digest}/${uuid}/${i}`,
      7,
      `etag-${i}`,
    ]);
  }
  expect(writes).toHaveBeenCalledTimes(2); // marker and index, never a chunk body
  const index = JSON.parse(Buffer.from(writes.mock.calls[1][1]).toString());
  expect(index.size).toBe(42);
  expect(index.chunks).toHaveLength(6);
  expect(deletes).toHaveBeenCalledWith(`registry/_uploads/${uuid}`);
});

test('digest mismatch and missing chunks publish nothing and retain the upload', async () => {
  const { reads, copies, writes, deletes } = setup();
  expect(await finalizeUpload('alice', 'image', uuid, 'sha256:' + 'a'.repeat(64))).toEqual({
    ok: false,
    reason: 'digest_mismatch',
  });
  expect(copies).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  expect(deletes).not.toHaveBeenCalled();
  reads.mockResolvedValue(null);
  expect(await finalizeUpload('alice', 'image', uuid, `sha256:${digest}`)).toEqual({
    ok: false,
    reason: 'missing',
  });
});

test('failed conditional copies never publish an index or delete upload sources', async () => {
  const { copies, writes, deletes } = setup();
  copies.mockRejectedValue(new Error('PreconditionFailed'));
  await expect(finalizeUpload('alice', 'image', uuid, `sha256:${digest}`)).rejects.toThrow(
    'PreconditionFailed',
  );
  expect(writes).not.toHaveBeenCalled();
  expect(deletes).toHaveBeenCalledTimes(1);
  expect(deletes).toHaveBeenCalledWith(`registry/alice/image/blob-chunks/sha256/${digest}/${uuid}`);
});
