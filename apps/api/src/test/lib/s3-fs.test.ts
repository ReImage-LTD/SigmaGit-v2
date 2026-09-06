import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createS3Fs } from '../../git/s3-fs';
import * as storage from '../../s3';
afterEach(() => mock.restore());

test('file stat performs one metadata read, including zero-byte files', async () => {
  const size = spyOn(storage, 'getObjectSize').mockResolvedValue(0);
  const exists = spyOn(storage, 'objectExists');
  const list = spyOn(storage, 'prefixExists');
  const stat = await createS3Fs('repos/u/repo').promises.stat('HEAD');
  expect(stat.isFile()).toBe(true);
  expect(stat.size).toBe(0);
  expect(size).toHaveBeenCalledTimes(1);
  expect(exists).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});

test('directory stat uses a bounded existence query', async () => {
  spyOn(storage, 'getObjectSize').mockResolvedValue(null);
  const exists = spyOn(storage, 'prefixExists').mockResolvedValue(true);
  const recursive = spyOn(storage, 'listObjects');
  expect((await createS3Fs('repos/u/repo').promises.stat('objects')).isDirectory()).toBe(true);
  expect(exists).toHaveBeenCalledWith('repos/u/repo/objects/');
  expect(recursive).not.toHaveBeenCalled();
});
