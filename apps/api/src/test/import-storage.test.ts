import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyImportedGit } from '../lib/import-storage';

test('imports packed refs, strips remote credentials and propagates failed writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigmagit-import-test-'));
  try {
    await mkdir(join(root, 'objects')); await mkdir(join(root, 'refs'));
    await writeFile(join(root, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(root, 'packed-refs'), 'a'.repeat(40) + ' refs/heads/main\n');
    await writeFile(join(root, 'config'), '[remote "origin"]\nurl=https://secret@example.test\n');
    const writes = new Map<string, string>();
    await copyImportedGit(root, async (key, body) => { writes.set(key, Buffer.from(body).toString()); });
    expect(writes.get('packed-refs')).toContain('refs/heads/main');
    expect(writes.get('config')).not.toContain('secret');
    await expect(copyImportedGit(root, async () => { throw new Error('storage unavailable'); })).rejects.toThrow('storage unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});
