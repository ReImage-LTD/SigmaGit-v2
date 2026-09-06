export interface GitRefUpdate {
  oldOid: string;
  newOid: string;
  ref: string;
}

export interface RefStorage {
  read(ref: string): Promise<string | null>;
  write(ref: string, oid: string): Promise<void>;
  remove(ref: string): Promise<void>;
}

/** Caller must hold the repository's distributed push lock throughout this operation. */
export async function applyRefUpdates(updates: GitRefUpdate[], storage: RefStorage) {
  const seen = new Set<string>();
  const zero = '0'.repeat(40);
  for (const update of updates) {
    if (!(update.ref.startsWith('refs/heads/') || update.ref.startsWith('refs/tags/')) ||
        /[\\\s~^:?*\[\x00-\x1f\x7f]/.test(update.ref) ||
        update.ref.includes('..') || update.ref.includes('@{') ||
        update.ref.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')) ||
        !/^[a-f0-9]{40}$/.test(update.oldOid) || !/^[a-f0-9]{40}$/.test(update.newOid) ||
        seen.has(update.ref)) {
      throw new Error('Invalid or duplicate ref update');
    }
    seen.add(update.ref);
    const current = (await storage.read(update.ref))?.trim() || zero;
    if (current !== update.oldOid) throw new Error('Stale ref update: ' + update.ref);
  }
  for (const update of updates) {
    if (update.newOid === zero) await storage.remove(update.ref);
    else await storage.write(update.ref, update.newOid);
  }
}
