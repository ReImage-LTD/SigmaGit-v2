import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStorageBackend } from '../../storage';

test('local storage preserves directory isolation, copy mapping and native streaming', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sigmagit-storage-test-'));
  const storage = new LocalStorageBackend(directory);
  try {
    await storage.put('repos/u/repo/HEAD', 'main');
    await storage.put('repos/u/repo/objects/ab', 'object');
    await storage.put('repos/u/repo-backup/HEAD', 'backup');
    expect(await storage.listDirectory('repos/u/repo')).toEqual(['HEAD', 'objects']);
    expect(await storage.getSize('repos/u/repo')).toBeNull();
    expect(await storage.getSize('repos/u/repo/HEAD')).toBe(4);
    const source = await storage.getWithMetadata('repos/u/repo/HEAD');
    await storage.copyObject('repos/u/repo/HEAD', 'repos/u/repo/copied', 4, source!.etag);
    expect((await storage.get('repos/u/repo/copied'))?.toString()).toBe('main');
    await storage.put('repos/u/repo/HEAD', 'changed');
    await expect(storage.copyObject('repos/u/repo/HEAD', 'repos/u/repo/stale', 4, source!.etag)).rejects.toThrow('changed');
    await storage.put('repos/u/repo/HEAD', 'main');
    expect(await storage.hasPrefix('repos/u/repo')).toBe(true);
    expect(await storage.hasPrefix('missing')).toBe(false);
    await storage.copyPrefix('repos/u/repo', 'repos/v/copy');
    expect((await storage.get('repos/v/copy/objects/ab'))?.toString()).toBe('object');
    expect(await new Response(await storage.getStream('repos/v/copy/HEAD')).text()).toBe('main');
    expect(await storage.getStream('missing')).toBeNull();
    await storage.deletePrefix('repos/u/repo');
    expect((await storage.get('repos/u/repo-backup/HEAD'))?.toString()).toBe('backup');
    expect(await storage.get('repos/u/repo/HEAD')).toBeNull();
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'sigmagit-storage-test-')) {
      throw new Error('Unexpected test cleanup path');
    }
    await rm(directory, {recursive: true, force: true});
  }
});
