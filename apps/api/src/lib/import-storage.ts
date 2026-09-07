import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Copy only Git data, never the clone's credential-bearing remote configuration. */
export async function copyImportedGit(root: string, put: (key: string, body: Uint8Array | string) => Promise<void>) {
  async function copyDirectory(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const key = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await copyDirectory(join(path, entry.name), key);
      else if (entry.isFile()) await put(key, await readFile(join(path, entry.name)));
      else throw new Error('Unsupported Git storage entry');
    }
  }
  await copyDirectory(join(root, 'objects'), 'objects');
  await copyDirectory(join(root, 'refs'), 'refs');
  let packed: Buffer | undefined;
  try { packed = await readFile(join(root, 'packed-refs')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (packed) await put('packed-refs', packed);
  await put('config', '[core]\n\tbare = true\n\trepositoryformatversion = 0\n');
  await put('HEAD', await readFile(join(root, 'HEAD')));
}
