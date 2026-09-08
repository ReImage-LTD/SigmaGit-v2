import type { PackObject } from './git-upload-pack';

interface FetchOptions {
  read: (oid: string) => Promise<PackObject>;
  wants: string[];
  haves: string[];
  maxObjectBytes: number;
  maxTraversalObjects: number;
  signal?: AbortSignal;
}

interface TreeLink {
  oid: string;
  tree: boolean;
}

function headerOids(data: Buffer, name: string): string[] {
  const header = data.toString('utf8').split('\n\n', 1)[0];
  return header
    .split('\n')
    .filter((line) => line.startsWith(name + ' '))
    .map((line) => {
      const oid = line.slice(name.length + 1);
      if (!/^[0-9a-f]{40}$/.test(oid)) throw new Error('Invalid Git object reference');
      return oid;
    });
}

function treeLinks(data: Buffer): TreeLink[] {
  const links: TreeLink[] = [];
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(32, offset);
    const nul = data.indexOf(0, space + 1);
    if (space < offset || nul < space || nul + 21 > data.length) {
      throw new Error('Invalid Git tree');
    }
    const mode = data.subarray(offset, space).toString('ascii');
    // Gitlinks refer to another repository; never traverse them as local commits.
    if (mode !== '160000') {
      links.push({
        oid: data.subarray(nul + 1, nul + 21).toString('hex'),
        tree: mode === '40000' || mode === '040000',
      });
    }
    offset = nul + 21;
  }
  return links;
}

/** Walk new history once, stopping at haves; only inspect the boundary snapshots. */
export async function* collectFetchObjects(options: FetchOptions): AsyncGenerator<PackObject> {
  const haves = new Set(options.haves);
  const visited = new Set<string>();
  const known = new Set<string>();
  const trees: string[] = [];
  const knownTrees: string[] = [];
  const pending = [...options.wants];
  let reads = 0;
  const read = async (oid: string) => {
    options.signal?.throwIfAborted();
    if (++reads > options.maxTraversalObjects) throw new Error('Fetch traversal budget exceeded');
    const object = await options.read(oid);
    if (object.data.length > options.maxObjectBytes)
      throw new Error('Fetch object exceeds size limit');
    return object;
  };

  while (pending.length) {
    const oid = pending.pop()!;
    if (visited.has(oid)) continue;
    visited.add(oid);
    const object = await read(oid);
    if (haves.has(oid)) {
      known.add(oid);
      if (object.type === 'commit') knownTrees.push(...headerOids(object.data, 'tree'));
      else if (object.type === 'tree') knownTrees.push(oid);
      else if (object.type === 'tag') {
        for (const target of headerOids(object.data, 'object')) {
          haves.add(target);
          pending.push(target);
        }
      }
      continue;
    }
    if (object.type === 'tree') {
      // Trees are processed after boundary snapshots, so shared blobs can be skipped.
      trees.push(oid);
      visited.delete(oid);
      continue;
    }
    yield object;
    if (object.type === 'commit') {
      trees.push(...headerOids(object.data, 'tree'));
      pending.push(...headerOids(object.data, 'parent'));
    } else if (object.type === 'tag') {
      pending.push(...headerOids(object.data, 'object'));
    }
  }

  const inspectedTrees = new Set<string>();
  while (knownTrees.length) {
    const oid = knownTrees.pop()!;
    if (inspectedTrees.has(oid)) continue;
    inspectedTrees.add(oid);
    known.add(oid);
    const object = await read(oid);
    if (object.type !== 'tree') throw new Error('Invalid boundary tree');
    for (const link of treeLinks(object.data)) {
      known.add(link.oid);
      if (known.size > options.maxTraversalObjects)
        throw new Error('Fetch traversal budget exceeded');
      if (link.tree) knownTrees.push(link.oid);
    }
  }

  while (trees.length) {
    const oid = trees.pop()!;
    if (visited.has(oid) || known.has(oid)) continue;
    visited.add(oid);
    const object = await read(oid);
    yield object;
    if (object.type === 'tree') {
      for (const link of treeLinks(object.data)) trees.push(link.oid);
    }
  }
}
