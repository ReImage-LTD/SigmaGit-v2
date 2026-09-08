import { listPackagePage } from '../../registry/package-list';
import type { DirectoryPageOptions } from '../../storage';
import { describe, expect, test } from 'bun:test';

describe('package listing', () => {
  test('paginates nested images without walking blob or manifest storage', async () => {
    const directories: Record<string, string[]> = {
      'registry/alice/': ['app-z', 'app', 'empty'],
      'registry/alice/app': ['blobs', 'blob-chunks', 'manifests', 'nested'],
      'registry/alice/app/nested': ['manifests'],
      'registry/alice/app-z': ['blobs'],
      'registry/alice/empty': [],
    };
    const reads: string[] = [];
    const tagged: string[] = [];
    const options = {
      owner: 'alice',
      limit: 1,
      hasPrefix: async (prefix: string) =>
        directories[prefix.slice(0, prefix.lastIndexOf('/'))]?.includes(
          prefix.slice(prefix.lastIndexOf('/') + 1),
        ) ?? false,
      listDirectoryPage: async (prefix: string, page: DirectoryPageOptions) => {
        reads.push(prefix);
        if (!(prefix in directories)) throw new Error(`Unexpected storage scan: ${prefix}`);
        const after = page.cursor ?? page.startAfter;
        const names = [...directories[prefix]]
          .sort((a, b) => (a + '/' < b + '/' ? -1 : 1))
          .filter((name) => !after || name + '/' > after + '/');
        return { entries: names.slice(0, 1), nextCursor: names.length > 1 ? names[0] : null };
      },
      listRefs: async (_owner: string, image: string) => {
        tagged.push(image);
        return ['latest'];
      },
    };
    const first = await listPackagePage(options);
    expect(first.packages.map((item) => item.name)).toEqual(['app-z']);
    expect(first.nextCursor).toBe('app-z');
    expect(tagged).toEqual(['app-z']);
    const second = await listPackagePage({ ...options, after: first.nextCursor! });
    expect(second.packages.map((item) => item.name)).toEqual(['app']);
    const third = await listPackagePage({ ...options, after: second.nextCursor! });
    expect(third.packages.map((item) => item.name)).toEqual(['app/nested']);
    expect(third.nextCursor).toBeNull();
    expect(reads.every((prefix) => !/\/(blobs|blob-chunks|manifests)$/.test(prefix))).toBe(true);
  });

  test('loads only page tags with at most four concurrent requests', async () => {
    let active = 0;
    let maximum = 0;
    let calls = 0;
    const result = await listPackagePage({
      owner: 'alice',
      limit: 5,
      hasPrefix: async () => true,
      listDirectoryPage: async (prefix, options) => {
        if (options.cursor) throw new Error('Unnecessary second storage page');
        return {
          entries:
            prefix === 'registry/alice/'
              ? Array.from(
                  { length: options.limit },
                  (_, i) => `image-${String(i).padStart(2, '0')}`,
                )
              : ['manifests'],
          nextCursor: prefix === 'registry/alice/' ? 'more' : null,
        };
      },
      listRefs: async () => {
        maximum = Math.max(maximum, ++active);
        calls++;
        await Bun.sleep(1);
        active--;
        return ['latest'];
      },
    });
    expect(result.packages).toHaveLength(5);
    expect(result.nextCursor).toBe('image-04');
    expect(calls).toBe(5);
    expect(maximum).toBe(4);
  });

  test('rejects invalid cursors and propagates storage errors and cancellation', async () => {
    const options = {
      owner: 'alice',
      limit: 20,
      listDirectoryPage: async () => ({ entries: [] as string[], nextCursor: null }),
      hasPrefix: async () => false,
      listRefs: async () => [] as string[],
    };
    for (const after of ['../bob', '/app', 'app/../../bob']) {
      await expect(listPackagePage({ ...options, after })).rejects.toThrow('cursor');
    }
    await expect(
      listPackagePage({
        ...options,
        listDirectoryPage: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow('offline');
    const controller = new AbortController();
    controller.abort();
    await expect(listPackagePage({ ...options, signal: controller.signal })).rejects.toThrow();
    expect(await listPackagePage(options)).toEqual({ packages: [], nextCursor: null });
  });
});
