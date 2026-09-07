import git from 'isomorphic-git';
import { createGitStore } from '../git';

export function parseWorkflowDefinition(content: string) {
  const parsed = Bun.YAML.parse(content) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || !parsed.jobs || typeof parsed.jobs !== 'object') throw new Error('Invalid workflow jobs');
  const raw = parsed.on;
  const events: Record<string, unknown> = typeof raw === 'string' ? { [raw]: {} }
    : Array.isArray(raw) ? Object.fromEntries(raw.map(event => [String(event), {}]))
    : raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const triggers: { push?: { branches?: string[] }; pull_request?: { branches?: string[] }; workflow_dispatch?: boolean } = {};
  for (const event of ['push', 'pull_request'] as const) {
    if (!(event in events)) continue;
    const options = events[event] as { branches?: unknown } | null;
    if (options?.branches !== undefined && (!Array.isArray(options.branches) || options.branches.some(branch => typeof branch !== 'string'))) throw new Error('Invalid workflow branches');
    triggers[event] = { branches: options?.branches as string[] | undefined };
  }
  if ('workflow_dispatch' in events) triggers.workflow_dispatch = true;
  return { name: typeof parsed.name === 'string' ? parsed.name : 'Unnamed Workflow', triggers };
}

export async function readWorkflowSnapshot(storageOwnerId: string, repoName: string, revision: string) {
  const store = createGitStore(storageOwnerId, repoName);
  const oid = /^[a-f0-9]{40}$/.test(revision) ? revision : await git.resolveRef({ fs: store.fs, dir: store.dir, ref: revision });
  await git.readCommit({ fs: store.fs, dir: store.dir, oid });
  const definitions = [];
  for (const directory of ['.sigmagit/workflows', '.github/workflows']) {
    let entries;
    try { entries = (await git.readTree({ fs: store.fs, dir: store.dir, oid, filepath: directory })).tree; }
    catch (error) { if ((error as { code?: string }).code === 'NotFoundError') continue; throw error; }
    for (const entry of entries) {
      if (entry.type !== 'blob' || !/\.ya?ml$/.test(entry.path)) continue;
      const { blob } = await git.readBlob({ fs: store.fs, dir: store.dir, oid: entry.oid });
      if (blob.length > 1024 * 1024) throw new Error('Workflow exceeds 1 MiB');
      const content = new TextDecoder().decode(blob);
      definitions.push({ path: `${directory}/${entry.path}`, content, ...parseWorkflowDefinition(content) });
    }
  }
  return { oid, definitions };
}
