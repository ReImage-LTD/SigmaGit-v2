import type { DirectoryPage, DirectoryPageOptions } from '../storage';
import { isValidOciImageName, isValidOciOwner } from './oci';
import { mapConcurrent } from '../lib/map-concurrent';

interface PackageListOptions {
  owner: string;
  limit: number;
  after?: string;
  listDirectoryPage: (prefix: string, options: DirectoryPageOptions) => Promise<DirectoryPage>;
  hasPrefix: (prefix: string) => Promise<boolean>;
  listRefs: (owner: string, image: string) => Promise<string[]>;
  signal?: AbortSignal;
}

/** Browse image directories only; never enumerate layer, chunk or manifest contents here. */
export async function listPackagePage(options: PackageListOptions) {
  const { owner, limit, after, listDirectoryPage, hasPrefix, listRefs, signal } = options;
  if (!isValidOciOwner(owner) || (after && !isValidOciImageName(after))) {
    throw new Error('Invalid package owner or cursor');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid package limit');
  const names: string[] = [];
  const afterParts = after?.split('/') ?? [];
  const storageDirectories = new Set(['blobs', 'blob-chunks', 'manifests']);
  const visit = async (parts: string[], resume = false): Promise<void> => {
    signal?.throwIfAborted();
    if (names.length > limit) return;
    const name = parts.join('/');
    const prefix = `registry/${owner}/${name}`;
    if (name && !resume) {
      const markers = await Promise.all(
        [...storageDirectories].map((marker) => hasPrefix(prefix + '/' + marker)),
      );
      if (markers.some(Boolean)) names.push(name);
    }
    if (names.length > limit) return;
    // Resume the cursor's subtree directly, then ask storage only for later siblings.
    const startAfter = resume ? afterParts[parts.length] : undefined;
    if (startAfter && !(parts.length && storageDirectories.has(startAfter))) {
      await visit([...parts, startAfter], true);
    }
    let cursor: string | undefined;
    do {
      if (names.length > limit) return;
      signal?.throwIfAborted();
      const page = await listDirectoryPage(prefix, { limit: limit + 1, cursor, startAfter });
      for (const entry of page.entries) {
        if (names.length > limit) return;
        if (parts.length && storageDirectories.has(entry)) continue;
        const child = [...parts, entry];
        if (!entry.includes('/') && isValidOciImageName(child.join('/'))) await visit(child);
      }
      if (page.nextCursor && page.nextCursor === cursor)
        throw new Error('Storage cursor did not advance');
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  };
  await visit([], Boolean(after));
  const page = names.slice(0, limit);
  const packages = await mapConcurrent(page, 4, async (name) => {
    signal?.throwIfAborted();
    // Propagate storage failures so clients can retry rather than see false empty tags.
    return { name, owner, tags: await listRefs(owner, name) };
  });
  return { packages, nextCursor: names.length > limit ? page[page.length - 1] : null };
}
