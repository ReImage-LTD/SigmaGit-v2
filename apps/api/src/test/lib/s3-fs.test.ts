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

test('writes invalidate cached missing directories and ancestor stats', async () => {
  let written = false;
  spyOn(storage, 'listDirectory').mockImplementation(async () => written ? ['new'] : []);
  spyOn(storage, 'getObjectSize').mockResolvedValue(null);
  spyOn(storage, 'prefixExists').mockImplementation(async () => written);
  spyOn(storage, 'putObject').mockImplementation(async () => { written = true; });
  const fs = createS3Fs('repos/u/repo').promises;
  expect(await fs.readdir('objects/ab')).toEqual([]);
  await expect(fs.stat('objects')).rejects.toThrow('ENOENT');
  await fs.writeFile('objects/ab/new', 'content');
  expect(await fs.readdir('objects/ab')).toEqual(['new']);
  expect((await fs.stat('objects')).isDirectory()).toBe(true);
});

test('an old directory miss cannot repopulate the cache after a write', async () => {
  let release!: (entries: string[]) => void;
  spyOn(storage, 'listDirectory')
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValue(['new']);
  spyOn(storage, 'putObject').mockResolvedValue(undefined);
  const fs = createS3Fs('repos/u/repo').promises;
  const oldRead = fs.readdir('objects/ab');
  await fs.writeFile('objects/ab/new', 'content');
  release([]);
  await oldRead;
  expect(await fs.readdir('objects/ab')).toEqual(['new']);
});
