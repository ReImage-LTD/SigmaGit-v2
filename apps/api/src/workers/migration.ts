import {
  db,
  repositoryMigrations,
  repositories,
  users,
  migrationCredentials,
  organizationMembers,
} from '@sigmagit/db';
import { resolveAndValidateOutbound } from '../security/ssrf';
import { decryptCredential } from '../lib/credential-cipher';
import { mkdir, rm, writeFile, stat } from 'fs/promises';
import { getRepoPrefix, putObject } from '../s3';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { isIP } from 'node:net';
import { join } from 'path';
import { spawn } from 'bun';

const TEMP_DIR = '/tmp/sigmagit-migrations';

// Build authenticated URL for git clone
function buildAuthenticatedUrl(
  sourceUrl: string,
  authType: string,
  authToken?: string,
  username?: string,
): string {
  if (!authToken) return sourceUrl;
  try {
    const url = new URL(sourceUrl);
    if (authType === 'token') {
      url.username = authToken;
      url.password = '';
    } else if (authType === 'password' && username) {
      url.username = username;
      url.password = authToken;
    }
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

// Setup SSH key for cloning
async function setupSshKey(
  sshKey: string,
  hostname: string,
  address: string,
): Promise<{ keyPath: string; sshCommand: string }> {
  const keyId = randomUUID();
  const keyDir = join(TEMP_DIR, 'ssh', keyId);
  const keyPath = join(keyDir, 'key');
  await mkdir(keyDir, { recursive: true });
  await writeFile(keyPath, sshKey, { mode: 0o600 });
  const sshScript = `#!/bin/sh\nexec ssh -i "${keyPath}" -o Hostname="${address}" -o HostKeyAlias="${hostname}" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null "$@"\n`;
  const sshScriptPath = join(keyDir, 'ssh-wrapper');
  await writeFile(sshScriptPath, sshScript, { mode: 0o700 });
  return { keyPath, sshCommand: sshScriptPath };
}

// Cleanup SSH key
async function cleanupSshKey(keyPath: string) {
  try {
    const keyDir = join(keyPath, '..');
    await rm(keyDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export async function processMigration(migrationId: string) {
  const [migration] = await db
    .select()
    .from(repositoryMigrations)
    .where(eq(repositoryMigrations.id, migrationId));
  if (!migration) {
    console.error(`[Migration] Migration ${migrationId} not found`);
    return;
  }

  // Get credentials if they exist
  const [creds] = await db
    .select()
    .from(migrationCredentials)
    .where(eq(migrationCredentials.migrationId, migrationId));
  let authToken: string | undefined;
  let sshKey: string | undefined;
  let authType = 'token';
  if (creds) {
    authType = creds.authType || 'token';
    if (creds.authToken) authToken = await decryptCredential(creds.authToken);
    if (creds.sshKey) sshKey = await decryptCredential(creds.sshKey);
  }

  try {
    await db
      .update(repositoryMigrations)
      .set({ status: 'cloning', progress: 10, startedAt: new Date(), updatedAt: new Date() })
      .where(eq(repositoryMigrations.id, migrationId));
    const [user] = await db.select().from(users).where(eq(users.id, migration.userId));
    if (!user) throw new Error('User not found');

    const tempRepoPath = join(TEMP_DIR, migrationId);
    await mkdir(tempRepoPath, { recursive: true });

    // SSRF: resolve DNS and pin to a public address so git cannot rebind later.
    const sourceResolved = await resolveAndValidateOutbound(migration.sourceUrl, {
      requireHttps: config.isProduction,
    });
    if (!sourceResolved.ok || !sourceResolved.url || !sourceResolved.addresses?.length) {
      throw new Error(`Blocked source URL: ${sourceResolved.error || 'invalid'}`);
    }

    // Prepare clone URL with authentication
    let cloneUrl = migration.sourceUrl;
    let sshCommand: string | undefined;
    let keyPath: string | undefined;
    const originalUrl = sourceResolved.url;
    const pinnedAddress = sourceResolved.addresses[0]!;
    const clonePort = originalUrl.port || (originalUrl.protocol === 'https:' ? '443' : '80');
    if (sshKey) {
      const sshSetup = await setupSshKey(sshKey, originalUrl.hostname, pinnedAddress);
      sshCommand = sshSetup.sshCommand;
      keyPath = sshSetup.keyPath;
      if (cloneUrl.startsWith('https://')) {
        try {
          const url = new URL(cloneUrl);
          cloneUrl = `git@${url.host}:${url.pathname.replace(/^\//, '').replace(/\.git$/, '')}.git`;
        } catch {
          /* keep original */
        }
      }
    } else if (authToken) {
      cloneUrl = buildAuthenticatedUrl(
        originalUrl.toString(),
        authType,
        authToken,
        migration.sourceOwner || undefined,
      );
    } else {
      cloneUrl = originalUrl.toString();
    }

    console.log(`[Migration] Cloning from ${migration.source}...`);
    const env: Record<string, string> = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (sshCommand) env.GIT_SSH = sshCommand;
    if (!sshCommand) {
      // CURLOPT_RESOLVE pins the connection while preserving URL hostname, TLS SNI,
      // certificate verification, and redirects handled by Git/cURL.
      env.GIT_CONFIG_COUNT = '2';
      env.GIT_CONFIG_KEY_0 = 'http.curloptResolve';
      const resolveAddress = isIP(pinnedAddress) === 6 ? `[${pinnedAddress}]` : pinnedAddress;
      env.GIT_CONFIG_VALUE_0 = `${originalUrl.hostname}:${clonePort}:${resolveAddress}`;
      env.GIT_CONFIG_KEY_1 = 'http.sslVerify';
      env.GIT_CONFIG_VALUE_1 = 'true';
    }
    const cloneProcess = spawn({
      cmd: ['git', 'clone', '--bare', '--single-branch', cloneUrl, tempRepoPath],
      cwd: TEMP_DIR,
      env,
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const [exitCode, stderr] = await Promise.all([
      cloneProcess.exited,
      new Response(cloneProcess.stderr).text(),
    ]);
    if (keyPath) await cleanupSshKey(keyPath);

    if (exitCode !== 0) {
      const errorMsg = stderr;
      if (
        errorMsg.includes('Authentication failed') ||
        errorMsg.includes('403') ||
        errorMsg.includes('401')
      ) {
        throw new Error('Authentication failed. Please check your credentials.');
      }
      if (errorMsg.includes('Repository not found') || errorMsg.includes('404')) {
        throw new Error('Repository not found. Please check the URL/owner/name.');
      }
      throw new Error(`Git clone failed: ${errorMsg}`);
    }

    await db
      .update(repositoryMigrations)
      .set({ progress: 50, status: 'importing', updatedAt: new Date() })
      .where(eq(repositoryMigrations.id, migrationId));

    const repoName =
      migration.sourceRepo ||
      migration.sourceUrl
        .split('/')
        .pop()
        ?.replace(/\.git$/, '') ||
      'imported-repo';
    const normalizedName = repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Organization placement: require owner/admin membership (same as create-repo).
    const options = (migration.options || {}) as {
      description?: string;
      visibility?: 'public' | 'private';
      organizationId?: string;
    };
    let organizationId: string | null = null;
    let storageOwnerId = user.id;
    if (options.organizationId) {
      const [member] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, options.organizationId),
            eq(organizationMembers.userId, user.id),
          ),
        );
      if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
        throw new Error("You don't have permission to create repositories in this organization");
      }
      organizationId = options.organizationId;
      storageOwnerId = options.organizationId;
    }

    const existing = await db.query.repositories.findFirst({
      where: and(
        organizationId
          ? eq(repositories.organizationId, organizationId)
          : eq(repositories.ownerId, user.id),
        eq(repositories.name, normalizedName),
      ),
    });
    if (existing) throw new Error('Repository with this name already exists');

    const [repo] = await db
      .insert(repositories)
      .values({
        name: normalizedName,
        description: options.description || null,
        visibility: options.visibility || 'public',
        ownerId: user.id,
        organizationId,
      })
      .returning();

    const targetPrefix = getRepoPrefix(storageOwnerId, normalizedName);
    const headContent = await Bun.file(join(tempRepoPath, 'HEAD'))
      .text()
      .catch(() => 'ref: refs/heads/main\n');
    await putObject(`${targetPrefix}/HEAD`, headContent);
    const configContent = await Bun.file(join(tempRepoPath, 'config'))
      .text()
      .catch(() => '[core]\n\tbare = true\n');
    await putObject(`${targetPrefix}/config`, configContent);

    const objectsPath = join(tempRepoPath, 'objects');
    try {
      const { readdir, readFile } = await import('fs/promises');
      async function copyDir(dirPath: string, prefix: string) {
        const entries = await readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);
          const relativePath = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) {
            await copyDir(fullPath, relativePath);
          } else {
            await putObject(`${targetPrefix}/${relativePath}`, await readFile(fullPath));
          }
        }
      }
      await copyDir(objectsPath, 'objects');
      try {
        await copyDir(join(tempRepoPath, 'refs'), 'refs');
      } catch {
        /* ignore */
      }
    } catch (error) {
      console.error('[Migration] Error copying objects:', error);
    }

    await db
      .update(repositoryMigrations)
      .set({ repositoryId: repo.id, progress: 90, updatedAt: new Date() })
      .where(eq(repositoryMigrations.id, migrationId));
    await db
      .update(repositoryMigrations)
      .set({ status: 'completed', progress: 100, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(repositoryMigrations.id, migrationId));

    console.log(`[Migration] Migration ${migrationId} completed`);
    await rm(tempRepoPath, { recursive: true, force: true });
  } catch (error) {
    console.error(`[Migration] Migration ${migrationId} failed:`, error);
    await db
      .update(repositoryMigrations)
      .set({
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: new Date(),
      })
      .where(eq(repositoryMigrations.id, migrationId));
    try {
      const tempRepoPath = join(TEMP_DIR, migrationId);
      await stat(tempRepoPath);
      await rm(tempRepoPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// Background worker - processes pending migrations
export async function startMigrationWorker() {
  console.log('[Migration] Starting migration worker...');

  setInterval(async () => {
    try {
      const pendingMigrations = await db
        .select()
        .from(repositoryMigrations)
        .where(eq(repositoryMigrations.status, 'pending'))
        .limit(1);

      for (const migration of pendingMigrations) {
        console.log(`[Migration] Processing migration ${migration.id}...`);
        await processMigration(migration.id);
      }
    } catch (error) {
      console.error('[Migration] Worker error:', error);
    }
  }, 10000); // Check every 10 seconds
}
