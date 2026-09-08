import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { requestContext } from '../lib/request-context';
import { copyImportedGit } from '../lib/import-storage';
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('uploads small files concurrently within the shared byte budget and publishes HEAD last', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigmagit-import-test-'));
  try {
    await mkdir(join(root, 'objects'));
    await mkdir(join(root, 'refs'));
    await writeFile(join(root, 'HEAD'), 'main');
    for (let i = 0; i < 12; i++)
      await writeFile(join(root, 'objects', String(i).padStart(2, '0')), Buffer.alloc(32, i));
    let active = 0;
    let bytes = 0;
    let peakActive = 0;
    let peakBytes = 0;
    const completed: string[] = [];
    await copyImportedGit(
      root,
      async (key, body) => {
        if (key.startsWith('objects/')) {
          peakActive = Math.max(peakActive, ++active);
          bytes += body.length;
          peakBytes = Math.max(peakBytes, bytes);
          await Bun.sleep(10);
          active--;
          bytes -= body.length;
        } else expect(active).toBe(0);
        completed.push(key);
      },
      { concurrency: 4, maxBufferedBytes: 96 },
    );
    expect(peakActive).toBe(3);
    expect(peakBytes).toBe(96);
    expect(completed).toHaveLength(14);
    expect(completed[completed.length - 1]).toBe('HEAD');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('drains active writes on failure and does not publish refs or HEAD', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigmagit-import-test-'));
  try {
    await mkdir(join(root, 'objects'));
    await mkdir(join(root, 'refs'));
    await writeFile(join(root, 'HEAD'), 'main');
    for (const name of ['a', 'b', 'c']) await writeFile(join(root, 'objects', name), 'data');
    let active = 0;
    const keys: string[] = [];
    await expect(
      copyImportedGit(root, async (key) => {
        keys.push(key);
        active++;
        try {
          await Bun.sleep(key.endsWith('/a') ? 5 : 25);
          if (key.endsWith('/a')) throw new Error('upload failed');
        } finally {
          active--;
        }
      }),
    ).rejects.toThrow('upload failed');
    expect(active).toBe(0);
    expect(keys.every((key) => key.startsWith('objects/'))).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestContext.run(controller.signal, () =>
        copyImportedGit(root, async () => {
          throw new Error('must not upload');
        }),
      ),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('imports packed refs, strips remote credentials and propagates failed writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigmagit-import-test-'));
  try {
    await mkdir(join(root, 'objects'));
    await mkdir(join(root, 'refs'));
    await writeFile(join(root, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(root, 'packed-refs'), 'a'.repeat(40) + ' refs/heads/main\n');
    await writeFile(join(root, 'config'), '[remote "origin"]\nurl=https://secret@example.test\n');
    const writes = new Map<string, string>();
    await copyImportedGit(root, async (key, body) => {
      writes.set(key, Buffer.from(body).toString());
    });
    expect(writes.get('packed-refs')).toContain('refs/heads/main');
    expect(writes.get('config')).not.toContain('secret');
    await expect(
      copyImportedGit(root, async () => {
        throw new Error('storage unavailable');
      }),
    ).rejects.toThrow('storage unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
