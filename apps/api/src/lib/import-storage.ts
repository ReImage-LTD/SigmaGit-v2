import { readdir, open, stat } from 'node:fs/promises';
import { requestSignal } from './request-context';
import { mapConcurrent } from './map-concurrent';
import { join } from 'node:path';

interface ImportCopyOptions {
  concurrency?: number;
  maxBufferedBytes?: number;
}

interface ImportFile {
  path: string;
  key: string;
  size: number;
}

const MAX_IMPORT_FILE_BYTES = 128 * 1024 * 1024;

/** Copy only Git data, never the clone's credential-bearing remote configuration. */
export async function copyImportedGit(
  root: string,
  put: (key: string, body: Uint8Array | string) => Promise<void>,
  options: ImportCopyOptions = {},
) {
  const concurrency = options.concurrency ?? 4;
  const maxBufferedBytes = options.maxBufferedBytes ?? MAX_IMPORT_FILE_BYTES;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 16 ||
    !Number.isSafeInteger(maxBufferedBytes) ||
    maxBufferedBytes < 1 ||
    maxBufferedBytes > MAX_IMPORT_FILE_BYTES
  ) {
    throw new Error('Invalid import copy limits');
  }
  const signal = requestSignal();
  const describe = async (path: string, key: string): Promise<ImportFile> => {
    signal?.throwIfAborted();
    const info = await stat(path);
    if (info.size > maxBufferedBytes) throw new Error('Import file exceeds buffer limit');
    return { path, key, size: info.size };
  };
  async function* files(path: string, prefix: string): AsyncGenerator<ImportFile> {
    signal?.throwIfAborted();
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const key = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) yield* files(join(path, entry.name), key);
      else if (entry.isFile()) yield await describe(join(path, entry.name), key);
      else throw new Error('Unsupported Git storage entry');
    }
  }
  const upload = async (file: ImportFile) => {
    signal?.throwIfAborted();
    // Read only the reserved size plus a one-byte growth check.
    const handle = await open(file.path, 'r');
    let body: Buffer;
    try {
      body = Buffer.alloc(file.size);
      let offset = 0;
      while (offset < body.length) {
        signal?.throwIfAborted();
        const result = await handle.read(body, offset, body.length - offset, offset);
        if (!result.bytesRead) throw new Error('Import file changed while reading');
        offset += result.bytesRead;
      }
      if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead)
        throw new Error('Import file changed while reading');
    } finally {
      await handle.close();
    }
    signal?.throwIfAborted();
    await put(file.key, body);
  };
  const copyDirectory = async (path: string, prefix: string) => {
    let batch: ImportFile[] = [];
    let bytes = 0;
    const flush = async () => {
      await mapConcurrent(batch, concurrency, upload);
      batch = [];
      bytes = 0;
    };
    for await (const file of files(path, prefix)) {
      if (batch.length && (batch.length >= concurrency * 2 || bytes + file.size > maxBufferedBytes))
        await flush();
      batch.push(file);
      bytes += file.size;
    }
    await flush();
  };
  await copyDirectory(join(root, 'objects'), 'objects');
  await copyDirectory(join(root, 'refs'), 'refs');
  let packed: ImportFile | undefined;
  try {
    packed = await describe(join(root, 'packed-refs'), 'packed-refs');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (packed) await upload(packed);
  signal?.throwIfAborted();
  await put('config', '[core]\n\tbare = true\n\trepositoryformatversion = 0\n');
  await upload(await describe(join(root, 'HEAD'), 'HEAD'));
}
