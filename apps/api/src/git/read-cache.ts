import { requestSignal } from '../lib/request-context';
import type { S3Fs } from './s3-fs';
import git from 'isomorphic-git';

const MAX_SESSION_BYTES = 128 * 1024 * 1024;
const MAX_SESSION_READS = 1000;

interface ReadSession {
  cache: object;
  bytes: number;
  reads: number;
  tail: Promise<unknown>;
  fs: S3Fs;
}

/** Account source buffers and decoded results conservatively, including cache hits. */
function resultBytes(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + resultBytes(item), 0);
  if (value && typeof value === 'object')
    return Object.values(value).reduce<number>((sum, item) => sum + resultBytes(item), 0);
  return 8;
}

export function createGitReadCache(maxBytes = MAX_SESSION_BYTES, maxReads = MAX_SESSION_READS) {
  const sessions = new WeakMap<S3Fs, ReadSession>();
  function sessionFor(fs: S3Fs): ReadSession {
    const existing = sessions.get(fs);
    if (existing) return existing;
    const session: ReadSession = {
      cache: {},
      bytes: 0,
      reads: 0,
      tail: Promise.resolve(),
      fs: {
        ...fs,
        promises: {
          ...fs.promises,
          async readFile(...args: Parameters<S3Fs['promises']['readFile']>) {
            const result = await fs.promises.readFile(...args);
            session.bytes += resultBytes(result);
            return result;
          },
        },
      },
    };
    sessions.set(fs, session);
    return session;
  }

  async function read<T>(fs: S3Fs, operation: (fs: S3Fs, cache: object) => Promise<T>): Promise<T> {
    const session = sessionFor(fs);
    const signal = requestSignal();
    const result = session.tail
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        try {
          const value = await operation(session.fs, session.cache);
          session.bytes += resultBytes(value);
          session.reads++;
          return value;
        } catch (error) {
          session.cache = {};
          session.bytes = 0;
          session.reads = 0;
          throw error;
        } finally {
          // Retain neither oversized packs nor an unlimited decoded-object history.
          // Individual in-flight reads still have the library's normal allocation cost.
          if (session.bytes >= maxBytes || session.reads >= maxReads) {
            session.cache = {};
            session.bytes = 0;
            session.reads = 0;
          }
        }
      });
    session.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  type ReadOptions<T> = Omit<T, 'fs' | 'cache'> & { fs: S3Fs };

  return {
    readObject: (options: ReadOptions<Parameters<typeof git.readObject>[0]>) =>
      read(options.fs, (fs, cache) => git.readObject({ ...options, fs, cache })),
    readCommit: (options: ReadOptions<Parameters<typeof git.readCommit>[0]>) =>
      read(options.fs, (fs, cache) => git.readCommit({ ...options, fs, cache })),
    readTree: (options: ReadOptions<Parameters<typeof git.readTree>[0]>) =>
      read(options.fs, (fs, cache) => git.readTree({ ...options, fs, cache })),
    readBlob: (options: ReadOptions<Parameters<typeof git.readBlob>[0]>) =>
      read(options.fs, (fs, cache) => git.readBlob({ ...options, fs, cache })),
    readTag: (options: ReadOptions<Parameters<typeof git.readTag>[0]>) =>
      read(options.fs, (fs, cache) => git.readTag({ ...options, fs, cache })),
  };
}

export const cachedGit = createGitReadCache();
