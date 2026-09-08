import { mkdtemp, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflate } from './async-zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface PackObject {
  type: 'commit' | 'tree' | 'blob' | 'tag';
  data: Buffer;
}

interface PackOptions {
  maxBytes: number;
  maxObjects: number;
  signal?: AbortSignal;
  tempDirectory?: string;
}

function objectHeader(type: number, size: number): Buffer {
  const bytes = [((type & 7) << 4) | (size & 15)];
  size = Math.floor(size / 16);
  while (size > 0) {
    bytes[bytes.length - 1] |= 128;
    bytes.push(size & 127);
    size = Math.floor(size / 128);
  }
  return Buffer.from(bytes);
}

/** Spool one object at a time; only the small response read buffer remains resident. */
export async function createUploadPackStream(
  objects: AsyncIterable<PackObject>,
  options: PackOptions,
): Promise<ReadableStream<Uint8Array>> {
  const directory = await mkdtemp(join(options.tempDirectory ?? tmpdir(), 'sigmagit-pack-'));
  const file = await open(join(directory, 'objects.pack'), 'w+').catch(async (error) => {
    await rm(directory, { recursive: true, force: true });
    throw error;
  });
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      try {
        await file.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    })());
  let count = 0;
  let expandedBytes = 0;
  let written = 0;
  try {
    const types = { commit: 1, tree: 2, blob: 3, tag: 4 };
    for await (const object of objects) {
      options.signal?.throwIfAborted();
      expandedBytes += object.data.length;
      if (++count > options.maxObjects || expandedBytes > options.maxBytes) {
        throw new Error('Upload pack exceeds object or byte budget');
      }
      const compressed = await deflate(object.data);
      options.signal?.throwIfAborted();
      for (const chunk of [objectHeader(types[object.type], object.data.length), compressed]) {
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset, written);
          if (!bytesWritten) throw new Error('Unable to write upload pack');
          offset += bytesWritten;
          written += bytesWritten;
        }
      }
    }
    options.signal?.throwIfAborted();
  } catch (error) {
    await cleanup();
    throw error;
  }

  const header = Buffer.alloc(12);
  header.write('PACK');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(count, 8);
  const hash = createHash('sha1').update(header);
  let position = 0;
  let started = false;
  let stopped = false;
  let onAbort: () => void;
  const stop = async () => {
    stopped = true;
    options.signal?.removeEventListener('abort', onAbort);
    await cleanup();
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        onAbort = () => {
          if (stopped) return;
          controller.error(options.signal?.reason);
          void stop().catch(() => {});
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });
        if (options.signal?.aborted) onAbort();
      },
      async pull(controller) {
        try {
          if (stopped) return;
          if (!started) {
            started = true;
            controller.enqueue(Buffer.concat([Buffer.from('0008NAK\n'), header]));
            return;
          }
          if (position < written) {
            const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, written - position));
            const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
            if (stopped) return;
            if (!bytesRead) throw new Error('Truncated upload pack spool');
            position += bytesRead;
            const chunk = buffer.subarray(0, bytesRead);
            hash.update(chunk);
            controller.enqueue(chunk);
            return;
          }
          const trailer = hash.digest();
          await stop();
          controller.enqueue(trailer);
          controller.close();
        } catch (error) {
          if (!stopped) {
            await stop().catch(() => {});
            controller.error(error);
          }
        }
      },
      cancel: stop,
    },
    { highWaterMark: 0 },
  );
}
