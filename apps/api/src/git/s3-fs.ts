import {
  getObject,
  putObject,
  deleteObject,
  listDirectory,
  prefixExists,
  deletePrefix,
  getObjectSize,
} from '../s3';
import { config } from '../config';

export interface S3FsStats {
  type: 'file' | 'dir';
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export function createS3Fs(basePath: string) {
  const negativeCache = new Map<string, number>();
  let mutationGeneration = 0;
  const negativeCacheTtlMs = Math.max(1000, config.optimizations.gitNegativeCacheTtlMs);

  const isMutableRefPath = (key: string): boolean => {
    const normalizedKey = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    const normalized = normalizedKey.startsWith(`${basePath}/`)
      ? normalizedKey.slice(basePath.length + 1)
      : normalizedKey;
    return normalized === 'HEAD' || normalized === 'packed-refs' || normalized.startsWith('refs/');
  };

  const hasNegative = (key: string): boolean => {
    if (!config.optimizations.gitNegativeCacheEnabled || isMutableRefPath(key)) {
      return false;
    }
    const expiresAt = negativeCache.get(key);
    if (!expiresAt) {
      return false;
    }
    if (expiresAt <= Date.now()) {
      negativeCache.delete(key);
      return false;
    }
    return true;
  };

  const markNegative = (key: string, generation = mutationGeneration): void => {
    if (generation !== mutationGeneration) return;
    if (!config.optimizations.gitNegativeCacheEnabled || isMutableRefPath(key)) {
      return;
    }
    negativeCache.set(key, Date.now() + negativeCacheTtlMs);
  };

  const clearNegative = (key: string): void => {
    negativeCache.delete(key);
  };

  const invalidateAncestors = (key: string): void => {
    mutationGeneration++;
    let current = key;
    while (current.length >= basePath.length) {
      clearNegative('file:' + current);
      clearNegative('stat:' + current);
      clearNegative('dir:' + current + '/');
      const slash = current.lastIndexOf('/');
      if (slash < 0) break;
      current = current.slice(0, slash);
    }
  };

  const normalize = (filepath: string): string => {
    let path = filepath.startsWith('/') ? filepath.slice(1) : filepath;
    if (path === '.git' || path === '.git/') {
      return basePath;
    }
    if (path.startsWith('.git/')) {
      path = path.slice(5);
    }
    if (!path || path === '/') {
      return basePath;
    }
    // Resolve . and .. to prevent path traversal outside basePath
    const parts = path.split('/').filter(Boolean);
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === '..') {
        resolved.pop();
      } else if (p !== '.') {
        resolved.push(p);
      }
    }
    const joined = resolved.join('/');
    if (!joined) return basePath;
    return `${basePath}/${joined}`.replace(/\/+/g, '/').replace(/\/$/, '');
  };

  const fs = {
    promises: {
      async readFile(
        filepath: string,
        options?: { encoding?: string } | string,
      ): Promise<Buffer | string> {
        const key = normalize(filepath);
        if (hasNegative(`file:${key}`)) {
          const err = new Error(
            `ENOENT: no such file or directory, open '${filepath}'`,
          ) as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        const generation = mutationGeneration;
        const data = await getObject(key);
        if (!data) {
          markNegative(`file:${key}`, generation);
          const err = new Error(
            `ENOENT: no such file or directory, open '${filepath}'`,
          ) as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        clearNegative(`file:${key}`);

        const encoding = typeof options === 'string' ? options : options?.encoding;
        if (encoding === 'utf8' || encoding === 'utf-8') {
          return data.toString('utf8');
        }
        return data;
      },

      async writeFile(filepath: string, data: Buffer | Uint8Array | string): Promise<void> {
        const key = normalize(filepath);
        await putObject(key, data instanceof Buffer ? data : Buffer.from(data));
        invalidateAncestors(key);
      },

      async unlink(filepath: string): Promise<void> {
        const key = normalize(filepath);
        await deleteObject(key);
        invalidateAncestors(key);
        markNegative(`file:${key}`);
        markNegative(`stat:${key}`);
      },

      async readdir(filepath: string): Promise<string[]> {
        const prefix = normalize(filepath);
        const searchPrefix = prefix.endsWith('/') ? prefix : prefix + '/';
        if (hasNegative(`dir:${searchPrefix}`)) {
          return [];
        }
        const generation = mutationGeneration;
        const entries = await listDirectory(searchPrefix);
        if (!entries.length) markNegative(`dir:${searchPrefix}`, generation);
        else clearNegative(`dir:${searchPrefix}`);
        return entries;
      },

      async mkdir(filepath: string, _options?: { recursive?: boolean }): Promise<void> {
        return;
      },

      async rmdir(filepath: string): Promise<void> {
        const prefix = normalize(filepath);
        await deletePrefix(prefix);
        invalidateAncestors(prefix);
      },

      async stat(filepath: string): Promise<S3FsStats> {
        const key = normalize(filepath);
        if (hasNegative(`stat:${key}`)) {
          const err = new Error(
            `ENOENT: no such file or directory, stat '${filepath}'`,
          ) as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }

        if (key === basePath) {
          return {
            type: 'dir',
            mode: 0o040755,
            size: 0,
            ino: 0,
            mtimeMs: Date.now(),
            ctimeMs: Date.now(),
            uid: 1000,
            gid: 1000,
            dev: 0,
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          };
        }

        const generation = mutationGeneration;
        const size = await getObjectSize(key);
        if (size !== null) {
          clearNegative(`file:${key}`);
          clearNegative(`stat:${key}`);
          return {
            type: 'file',
            mode: 0o100644,
            size,
            ino: 0,
            mtimeMs: Date.now(),
            ctimeMs: Date.now(),
            uid: 1000,
            gid: 1000,
            dev: 0,
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          };
        }

        const dirPrefix = key + '/';
        if (await prefixExists(dirPrefix)) {
          clearNegative(`dir:${dirPrefix}`);
          clearNegative(`stat:${key}`);
          return {
            type: 'dir',
            mode: 0o040755,
            size: 0,
            ino: 0,
            mtimeMs: Date.now(),
            ctimeMs: Date.now(),
            uid: 1000,
            gid: 1000,
            dev: 0,
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          };
        }

        markNegative(`stat:${key}`, generation);
        markNegative(`file:${key}`, generation);
        markNegative(`dir:${dirPrefix}`, generation);
        const err = new Error(
          `ENOENT: no such file or directory, stat '${filepath}'`,
        ) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },

      async lstat(filepath: string): Promise<S3FsStats> {
        return this.stat(filepath);
      },

      async readlink(filepath: string): Promise<string> {
        const data = await this.readFile(filepath, 'utf8');
        return data as string;
      },

      async symlink(target: string, filepath: string): Promise<void> {
        await this.writeFile(filepath, target);
      },

      async chmod(_filepath: string, _mode: number): Promise<void> {
        return;
      },

      async rename(oldPath: string, newPath: string): Promise<void> {
        const data = await this.readFile(oldPath);
        await this.writeFile(newPath, data as Buffer);
        await this.unlink(oldPath);
      },
    },
  };

  return fs;
}

export type S3Fs = ReturnType<typeof createS3Fs>;
