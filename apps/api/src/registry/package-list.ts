import { isValidOciImageName, isValidOciOwner } from './oci';
import { mapConcurrent } from '../lib/map-concurrent';

interface PackageListOptions {
  owner: string;
  limit: number;
  after?: string;
  listDirectory: (prefix: string) => Promise<string[]>;
  listRefs: (owner: string, image: string) => Promise<string[]>;
  signal?: AbortSignal;
}

/** Browse image directories only; never enumerate layer, chunk or manifest contents here. */
export async function listPackagePage(options: PackageListOptions) {
  const { owner, limit, after, listDirectory, listRefs, signal } = options;
  if (!isValidOciOwner(owner) || (after && !isValidOciImageName(after))) {
    throw new Error('Invalid package owner or cursor');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid package limit');
  const names: string[] = [];
  const afterParts = after?.split('/') ?? [];
  const storageDirectories = new Set(['blobs', 'blob-chunks', 'manifests']);
  const visit = async (parts: string[]) => {
    signal?.throwIfAborted();
    if (names.length > limit) return;
    // Match the depth-first, component-wise order used by this traversal.
    let comparison = 0;
    for (let i = 0; i < Math.min(parts.length, afterParts.length); i++) {
      if (parts[i] !== afterParts[i]) {
        comparison = parts[i] < afterParts[i] ? -1 : 1;
        break;
      }
    }
    if (comparison < 0) return;
    const name = parts.join('/');
    const entries = await listDirectory(`registry/${owner}/${name}`);
    const pastCursor = !after || comparison > 0 || parts.length > afterParts.length;
    if (name && pastCursor && entries.some((entry) => storageDirectories.has(entry)))
      names.push(name);
    for (const entry of entries.sort()) {
      if (names.length > limit) break;
      if (storageDirectories.has(entry) && parts.length) continue;
      const child = [...parts, entry];
      if (!entry.includes('/') && isValidOciImageName(child.join('/'))) await visit(child);
    }
  };
  await visit([]);
  const page = names.slice(0, limit);
  const packages = await mapConcurrent(page, 4, async (name) => {
    signal?.throwIfAborted();
    // Propagate storage failures so clients can retry rather than see false empty tags.
    return { name, owner, tags: await listRefs(owner, name) };
  });
  return { packages, nextCursor: names.length > limit ? page[page.length - 1] : null };
}
