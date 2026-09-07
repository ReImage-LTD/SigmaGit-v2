import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Readers see the previous complete file or its complete replacement. */
export async function atomicWriteFile(path: string, data: string | Uint8Array, temporaryDirectory: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  await mkdir(temporaryDirectory, { recursive: true });
  const temporary = join(temporaryDirectory, crypto.randomUUID());
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(data);
    await file.sync();
    await file.close(); file = undefined;
    signal?.throwIfAborted();
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, path); break; }
      catch (error) {
        if (process.platform !== 'win32' || attempt >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await delay(10 * 2 ** Math.min(attempt, 4), undefined, { signal });
      }
    }
    // Windows does not support opening directories for fsync through this API.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
