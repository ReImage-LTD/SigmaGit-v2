import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createGitReadCache } from '../../git/read-cache';
import { createS3Fs } from '../../git/s3-fs';
import * as storage from '../../s3';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => mock.restore());

test('packed reads reuse pack data and rotate at the retention budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sigmagit-read-cache-test-'));
  const command = (...args: string[]) => {
    const result = Bun.spawnSync(['git', '-C', directory, ...args]);
    if (result.exitCode) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  try {
    command('init');
    for (const text of ['first', 'second']) {
      await writeFile(join(directory, 'file'), text);
      command('add', 'file');
      command('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', text);
    }
    command('repack', '-ad');
    const head = command('rev-parse', 'HEAD');
    const parent = command('rev-parse', 'HEAD~1');
    const gets: string[] = [];
    spyOn(storage, 'getObject').mockImplementation(async (key) => {
      gets.push(key);
      try {
        return await readFile(join(directory, '.git', key.slice('repos/test/repo/'.length)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    });
    spyOn(storage, 'listDirectory').mockImplementation(async (key) =>
      readdir(join(directory, '.git', key.slice('repos/test/repo/'.length))),
    );
    const fs = createS3Fs('repos/test/repo');
    const reader = createGitReadCache();
    const values = await Promise.all(
      [head, parent].map((oid) => reader.readCommit({ fs, dir: '/', oid })),
    );
    expect(values.map((value) => value.commit.message.trim())).toEqual(['second', 'first']);
    expect(gets.filter((key) => key.endsWith('.pack'))).toHaveLength(1);
    expect(gets.filter((key) => key.endsWith('.idx'))).toHaveLength(1);

    gets.length = 0;
    const tiny = createGitReadCache(1);
    await tiny.readCommit({ fs, dir: '/', oid: head });
    await tiny.readCommit({ fs, dir: '/', oid: parent });
    expect(gets.filter((key) => key.endsWith('.pack'))).toHaveLength(2);
    // A separate filesystem has an independent cache even for an identical path.
    gets.length = 0;
    await reader.readCommit({ fs: createS3Fs('repos/test/repo'), dir: '/', oid: head });
    expect(gets.filter((key) => key.endsWith('.pack'))).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
