import { expect, test } from 'bun:test';
import { runImportCommand, checkImportDisk } from '../lib/import-process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('import cancellation terminates the process tree and preserves the reason', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('deadline')), 100);
  try {
    const script = 'Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stderr: "inherit", stdout: "ignore" }); setInterval(() => {}, 1000)';
    await expect(runImportCommand([process.execPath, '-e', script], tmpdir(), controller.signal)).rejects.toThrow('deadline');
  } finally { clearTimeout(timer); }
});

test('import disk budget counts aggregate files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sigmagit-budget-'));
  try {
    await writeFile(join(root, 'a'), '1234'); await writeFile(join(root, 'b'), '1234');
    expect(await checkImportDisk(root, 8)).toBe(8);
    await expect(checkImportDisk(root, 7)).rejects.toThrow('disk budget');
  } finally { await rm(root, { recursive: true, force: true }); }
});
