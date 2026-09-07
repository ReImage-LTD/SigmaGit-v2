import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkImportDisk(path: string, maxBytes: number): Promise<number> {
  let total = 0;
  async function visit(dir: string) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        try { total += (await stat(full)).size; }
        catch (error) {
          // Git atomically renames temporary pack files while cloning.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        if (total > maxBytes) throw new Error('Import exceeds disk budget');
      } else throw new Error('Unsupported import filesystem entry');
    }
  }
  await visit(path);
  return total;
}

export async function runImportCommand(cmd: string[], cwd: string, signal: AbortSignal, env = process.env) {
  signal.throwIfAborted();
  const child = Bun.spawn({ cmd, cwd, env, stdout: 'ignore', stderr: 'pipe' });
  const kill = () => child.kill('SIGKILL');
  signal.addEventListener('abort', kill, { once: true });
  if (signal.aborted) kill();
  // Drain output without retaining it: Git diagnostics can contain credentials.
  const drain = (async () => {
    const reader = child.stderr.getReader();
    try { while (!(await reader.read()).done) {} }
    finally { reader.releaseLock(); }
  })();
  try {
    const [code] = await Promise.all([child.exited, drain]);
    signal.throwIfAborted();
    if (code !== 0) throw new Error('Git import command failed; verify source access and repository integrity');
  } finally {
    signal.removeEventListener('abort', kill);
    if (child.exitCode === null) { kill(); await child.exited; }
  }
}
