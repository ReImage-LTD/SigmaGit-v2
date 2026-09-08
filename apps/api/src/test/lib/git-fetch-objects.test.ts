import { createUploadPackStream } from '../../lib/git-upload-pack';
import { collectFetchObjects } from '../../lib/git-fetch-objects';
import type { PackObject } from '../../lib/git-upload-pack';
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function fixture() {
  const objects = new Map<string, PackObject>();
  const reads: string[] = [];
  const add = (type: PackObject['type'], content: Buffer | string) => {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const oid = createHash('sha1').update(`${type} ${data.length}\0`).update(data).digest('hex');
    objects.set(oid, { type, data });
    return oid;
  };
  const tree = (entries: Array<[string, string, string]>) =>
    add(
      'tree',
      Buffer.concat(
        entries.map(([mode, name, oid]) =>
          Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, 'hex')]),
        ),
      ),
    );
  const commit = (root: string, parents: string[] = []) =>
    add(
      'commit',
      `tree ${root}\n${parents.map((oid) => `parent ${oid}\n`).join('')}author A <a@example.com> 1 +0000\ncommitter A <a@example.com> 1 +0000\n\nmessage\n`,
    );
  const read = async (oid: string) => {
    reads.push(oid);
    const object = objects.get(oid);
    if (!object) throw new Error(`Missing ${oid}`);
    return object;
  };
  const collect = async (wants: string[], haves: string[] = []) => {
    const result: PackObject[] = [];
    for await (const object of collectFetchObjects({
      wants,
      haves,
      read,
      maxObjectBytes: 1024 * 1024,
      maxTraversalObjects: 1000,
    }))
      result.push(object);
    return result;
  };
  return { objects, reads, add, tree, commit, read, collect };
}

describe('fetch object traversal', () => {
  test('native Git accepts a clone pack followed by an incremental fetch pack', async () => {
    const f = fixture();
    const shared = f.add('blob', 'shared');
    const base = f.commit(f.tree([['100644', 'shared', shared]]));
    const added = f.add('blob', 'added');
    const head = f.commit(
      f.tree([
        ['100644', 'added', added],
        ['100644', 'shared', shared],
      ]),
      [base],
    );
    const directory = await mkdtemp(join(tmpdir(), 'fetch-native-test-'));
    try {
      expect(Bun.spawnSync(['git', 'init', '--bare', directory]).exitCode).toBe(0);
      for (const [want, haves] of [
        [base, []],
        [head, [base]],
      ] as Array<[string, string[]]>) {
        const stream = await createUploadPackStream(
          collectFetchObjects({
            wants: [want],
            haves,
            read: f.read,
            maxObjectBytes: 100_000,
            maxTraversalObjects: 100,
          }),
          { maxBytes: 100_000, maxObjects: 100, tempDirectory: directory },
        );
        const wire = Buffer.from(await new Response(stream).arrayBuffer());
        const result = Bun.spawnSync(
          ['git', '--git-dir', directory, 'index-pack', '--stdin', '--strict'],
          {
            stdin: wire.subarray(8),
          },
        );
        expect(result.stderr.toString()).toBe('');
        expect(result.exitCode).toBe(0);
      }
      const result = Bun.spawnSync([
        'git',
        '--git-dir',
        directory,
        'cat-file',
        '-p',
        `${head}:added`,
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe('added');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('reads only new history and boundary trees, skipping unchanged blobs and old ancestors', async () => {
    const f = fixture();
    const shared = f.add('blob', 'unchanged');
    const subtree = f.tree([['100644', 'shared', shared]]);
    const oldTree = f.tree([['40000', 'dir', subtree]]);
    // Deliberately absent ancestor: the client-held commit must stop the history walk.
    const base = f.commit(oldTree, ['1'.repeat(40)]);
    const changed = f.add('blob', 'new file');
    const newTree = f.tree([
      ['40000', 'dir', subtree],
      ['100644', 'new', changed],
    ]);
    const head = f.commit(newTree, [base]);
    const result = await f.collect([head], [base]);
    expect(result).toEqual([
      f.objects.get(head)!,
      f.objects.get(newTree)!,
      f.objects.get(changed)!,
    ]);
    expect(f.reads).not.toContain(shared);
    expect(f.reads).not.toContain('1'.repeat(40));
    expect(f.reads.length).toBe(6);
    expect(new Set(f.reads).size).toBe(f.reads.length);
  });

  test('includes both merge parents and annotated tags, but never follows gitlinks', async () => {
    const f = fixture();
    const blob = f.add('blob', 'file');
    const root = f.tree([
      ['100644', 'file', blob],
      ['160000', 'submodule', '2'.repeat(40)],
    ]);
    const base = f.commit(root);
    const left = f.commit(root, [base]);
    const right = f.add('commit', `tree ${root}\nparent ${base}\n\nright\n`);
    const merge = f.commit(root, [left, right]);
    const tag = f.add('tag', `object ${merge}\ntype commit\ntag release\n\nrelease\n`);
    const result = await f.collect([tag]);
    expect(result).toHaveLength(7);
    for (const oid of [tag, merge, left, right, base, root, blob]) {
      expect(result).toContain(f.objects.get(oid)!);
      expect(f.reads.filter((read) => read === oid)).toHaveLength(1);
    }
    expect(f.reads).not.toContain('2'.repeat(40));
  });

  test('fails on missing objects, traversal budgets, oversized objects and cancellation', async () => {
    const f = fixture();
    await expect(f.collect(['3'.repeat(40)])).rejects.toThrow('Missing');
    const blob = f.add('blob', 'hello');
    const controller = new AbortController();
    controller.abort();
    for (const extra of [
      { maxTraversalObjects: 0 },
      { maxObjectBytes: 1 },
      { signal: controller.signal },
    ]) {
      const iterator = collectFetchObjects({
        wants: [blob],
        haves: [],
        read: f.read,
        maxTraversalObjects: 10,
        maxObjectBytes: 100,
        ...extra,
      });
      await expect(iterator.next()).rejects.toThrow();
    }
  });
});
