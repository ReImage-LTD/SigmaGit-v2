import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from '../lib/atomic-file';

test('concurrent readers see complete replacements and temporary files are removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigmagit-atomic-'));
  const target = join(root, 'HEAD'); const temporary = join(root, '.writes');
  try {
    await atomicWriteFile(target, 'a'.repeat(65536), temporary);
    let running = true;
    const reader = (async () => {
      while (running) {
        const data = await readFile(target, 'utf8');
        expect(data.length).toBe(65536);
        expect(data).toBe(data[0].repeat(65536));
      }
    })();
    try { for (const letter of ['b', 'c', 'd', 'e']) await atomicWriteFile(target, letter.repeat(65536), temporary); }
    finally { running = false; await reader; }
    expect(await readdir(temporary)).toEqual([]);
    const blocked = join(root, 'directory'); await mkdir(blocked);
    await expect(atomicWriteFile(blocked, 'fail', temporary)).rejects.toThrow();
    expect(await readdir(temporary)).toEqual([]);
    expect((await readFile(target, 'utf8'))[0]).toBe('e');
  } finally { await rm(root, { recursive: true, force: true }); }
});
