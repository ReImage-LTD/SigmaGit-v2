import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import postgres from 'postgres';

// Only use a disposable, explicitly supplied local PostgreSQL instance.
const base = new URL(process.env.RUNNER_TEST_DATABASE_URL ?? '');
assert(['localhost', '127.0.0.1'].includes(base.hostname));
assert.equal(base.pathname, '/runner_e2e');
const databaseName = `runner_e2e_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = postgres(base.toString(), { max: 1 });
await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
const storagePath = await mkdtemp(join(tmpdir(), 'sigmagit-runner-e2e-'));
base.pathname = `/${databaseName}`;
Object.assign(process.env, {
  DATABASE_URL: base.toString(),
  STORAGE_TYPE: 'local',
  STORAGE_LOCAL_PATH: storagePath,
  REDIS_URL: '',
  REDIS_SESSION_URL: '',
  REDIS_CACHE_URL: '',
  ENABLE_MIGRATIONS: 'false',
  NODE_ENV: 'test',
  PROD: 'false',
  RUNNER_REGISTRATION_SECRET: 'integration-registration-secret-only',
  BETTER_AUTH_SECRET: 'integration-only-better-auth-secret-123456',
});
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  const exportSchema = Bun.spawn(
    [
      process.execPath,
      'x',
      'drizzle-kit',
      'export',
      '--dialect',
      'postgresql',
      '--schema',
      './src/schema.ts',
    ],
    {
      cwd: resolve(import.meta.dir, '../../../packages/db'),
      stdout: 'pipe',
      stderr: 'inherit',
      env: process.env,
    },
  );
  const schemaSql = await new Response(exportSchema.stdout).text();
  assert.equal(await exportSchema.exited, 0);
  const sql = postgres(base.toString(), { max: 1 });
  await sql.unsafe(schemaSql);
  await sql.end();
  const {
    db,
    users,
    sessions,
    apiKeys,
    repositories,
    workflows,
    workflowRuns,
    workflowJobs,
    workflowSteps,
  } = await import('@sigmagit/db');
  const { eq, sql: statement } = await import('drizzle-orm');
  const git = (await import('isomorphic-git')).default;
  const { createGitStore } = await import('../src/git');
  const ownerId = crypto.randomUUID();
  await db.insert(users).values({
    id: ownerId,
    name: 'Runner test',
    username: 'runner-test',
    email: 'runner@example.invalid',
  });
  // Exercise the upgrade against a pre-existing key, not just a fresh schema.
  await db.execute(statement`ALTER TABLE api_key DROP COLUMN config_id`);
  await db.execute(
    statement`INSERT INTO api_key (id, key, user_id) VALUES ('legacy-fixture', 'not-a-real-key', ${ownerId})`,
  );
  await db.execute(
    statement.raw(
      await Bun.file(
        resolve(import.meta.dir, '../../../packages/db/migrations/0007_api_key_configuration.sql'),
      ).text(),
    ),
  );
  assert.equal(
    (await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, 'legacy-fixture') }))?.configId,
    'default',
  );
  const [repo] = await db
    .insert(repositories)
    .values({
      ownerId,
      storageOwnerId: ownerId,
      name: 'private-test',
      visibility: 'private',
      defaultBranch: 'main',
    })
    .returning();
  const store = createGitStore(ownerId, repo.name);
  await git.init({ fs: store.fs, dir: store.dir, defaultBranch: 'main' });
  await store.fs.promises.writeFile('/README.md', 'private checkout marker\n');
  await git.add({ fs: store.fs, dir: store.dir, filepath: 'README.md' });
  let commitSha = await git.commit({
    fs: store.fs,
    dir: store.dir,
    message: 'integration fixture',
    author: { name: 'Test', email: 'test@example.invalid' },
  });
  const workflowContent = `name: Integration
on: workflow_dispatch
jobs:
  first:
    runs-on: ubuntu-latest
    outputs:
      value: \${{ steps.produce.outputs.value }}
    steps:
      - uses: actions/checkout@v4
      - id: produce
        run: |
          test -f README.md
          echo "value=roundtrip" >> "$GITHUB_OUTPUT"
          echo "FIRST_JOB_MARKER"
  second:
    needs: first
    runs-on: ubuntu-latest
    steps:
      - run: |
          test "\${{ needs.first.outputs.value }}" = "roundtrip"
          echo "SECOND_JOB_MARKER"
`;
  await store.fs.promises.mkdir('/.github');
  await store.fs.promises.mkdir('/.github/workflows');
  await store.fs.promises.writeFile('/.github/workflows/test.yml', workflowContent);
  await git.add({ fs: store.fs, dir: store.dir, filepath: '.github/workflows/test.yml' });
  commitSha = await git.commit({ fs: store.fs, dir: store.dir, message: 'workflow snapshot', author: { name: 'Test', email: 'test@example.invalid' } });
  const [workflow] = await db
    .insert(workflows)
    .values({
      repositoryId: repo.id,
      name: 'Integration',
      path: '.github/workflows/test.yml',
      content: workflowContent,
      triggers: { workflow_dispatch: true },
    })
    .returning();
  const api = (await import('../src/index')).default;
  server = Bun.serve({ ...api, port: 0, hostname: '127.0.0.1' });
  const baseURL = `http://127.0.0.1:${server.port}`;
  const sessionToken = crypto.randomUUID();
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId: ownerId,
    token: sessionToken,
    expiresAt: new Date(Date.now() + 300_000),
  });
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!)
    .update(sessionToken)
    .digest('base64');
  const { getAllowedOrigins } = await import('../src/config');
  const dispatchHeaders = {
    origin: getAllowedOrigins()[0],
    cookie: `sigmagit_dev.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`,
    'content-type': 'application/json',
  };
  const { checkReleaseAuthorization } = await import('./release-authorization');
  const { checkOrganizationAuthorization } = await import('./organization-authorization');
  await checkOrganizationAuthorization(baseURL);
  const { checkProjectAuthorization } = await import('./project-authorization');
  await checkProjectAuthorization(baseURL);
  const { checkMigrationClaims } = await import('./migration-claims');
  await checkMigrationClaims(ownerId);
  const { checkBackgroundTasks } = await import('./background-tasks');
  await checkBackgroundTasks(repo.id, ownerId);
  await checkReleaseAuthorization({
    baseURL,
    ownerId,
    repositoryId: repo.id,
    headers: dispatchHeaders,
  });
  const keyResponse = await fetch(`${baseURL}/api/auth/api-key/create`, {
    method: 'POST',
    headers: dispatchHeaders,
    body: JSON.stringify({ name: 'Integration key' }),
  });
  assert.equal(keyResponse.status, 200, await keyResponse.clone().text());
  const key = (await keyResponse.json()) as { key: string };
  assert.equal(
    (
      await fetch(`${baseURL}/runner-test/private-test.git/info/refs?service=git-upload-pack`, {
        headers: {
          authorization: `Basic ${Buffer.from(`runner-test:${key.key}`).toString('base64')}`,
        },
      })
    ).status,
    200,
  );
  const dispatched = await fetch(
    `${baseURL}/api/repositories/runner-test/private-test/workflows/${workflow.id}/dispatch`,
    { method: 'POST', headers: dispatchHeaders, body: JSON.stringify({ ref: 'main', commitSha }) },
  );
  assert.equal(dispatched.status, 200, await dispatched.clone().text());
  const {
    runIds: [runId],
  } = (await dispatched.json()) as { runIds: string[] };
  assert(runId);
  const agent = Bun.spawn(
    [
      process.env.GO_BINARY ?? 'go',
      'test',
      './cmd/agent',
      '-run',
      '^TestAPIEndToEnd$',
      '-count=1',
      '-timeout=6m',
      '-v',
    ],
    {
      cwd: resolve(import.meta.dir, '../../runner'),
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        SIGMAGIT_TEST_API_URL: `http://127.0.0.1:${server.port}`,
        SIGMAGIT_TEST_COMMIT: commitSha,
        SIGMAGIT_TEST_REGISTRATION_SECRET: process.env.RUNNER_REGISTRATION_SECRET,
      },
    },
  );
  const exitCode = await agent.exited;
  if (exitCode !== 0) {
    const failedSteps = await db.select().from(workflowSteps);
    for (const step of failedSteps) console.error(step.name, step.logOutput?.slice(-1500));
  }
  assert.equal(exitCode, 0, 'Go agent round trip failed');
  const run = await db.query.workflowRuns.findFirst({ where: eq(workflowRuns.id, runId) });
  assert.equal(run?.status, 'completed');
  assert.equal(run?.conclusion, 'success');
  const jobs = await db.select().from(workflowJobs).where(eq(workflowJobs.runId, runId));
  assert.equal(jobs.length, 1, 'workflow dependencies must not be executed twice');
  const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.jobId, jobs[0].id));
  const logs = steps.map((step) => step.logOutput ?? '').join('\n');
  assert(logs.includes('FIRST_JOB_MARKER') && logs.includes('SECOND_JOB_MARKER'));
  assert(steps.every((step) => step.status === 'completed'));
  console.log(
    'PASS: authenticated registration, private Git checkout, heartbeats, dependent Docker jobs, logs, completion, and credential expiry',
  );
  const { checkRunnerProtocol } = await import('./runner-protocol');
  const { runner, ownerHeaders } = await checkRunnerProtocol({
    baseURL,
    ownerId,
    repositoryId: repo.id,
    workflowId: workflow.id,
    commitSha,
  });
  for (const scenario of ['exit-code', 'unsupported-platform', 'bad-revision', 'cancel'] as const) {
    const [failureRun] = await db
      .insert(workflowRuns)
      .values({
        repositoryId: repo.id,
        workflowId: workflow.id,
        commitSha: scenario === 'bad-revision' ? 'f'.repeat(40) : commitSha,
        branch: 'main',
        eventName: 'workflow_dispatch',
        status: 'queued',
      })
      .returning();
    const content = `name: Failure\non: workflow_dispatch\njobs:\n  test:\n    runs-on: ${scenario === 'unsupported-platform' ? 'windows-latest' : 'ubuntu-latest'}\n    steps:\n      - run: ${scenario === 'cancel' ? 'echo CANCEL_READY; sleep 90' : 'exit 17'}\n`;
    const [failureJob] = await db
      .insert(workflowJobs)
      .values({
        runId: failureRun.id,
        name: 'Failure',
        status: 'queued',
        workflowDefinition: { executionMode: 'workflow', workflowContent: content },
      })
      .returning();
    const agentProcess = Bun.spawn(
      [
        process.env.GO_BINARY ?? 'go',
        'test',
        './cmd/agent',
        '-run',
        '^TestAPIFailedJob$',
        '-count=1',
        '-timeout=1m',
        '-v',
      ],
      {
        cwd: resolve(import.meta.dir, '../../runner'),
        stdout: 'inherit',
        stderr: 'inherit',
        env: {
          ...process.env,
          SIGMAGIT_TEST_API_URL: baseURL,
          SIGMAGIT_TEST_RUNNER_ID: runner.id,
          SIGMAGIT_TEST_RUNNER_TOKEN: runner.token,
        },
      },
    );
    try {
      if (scenario === 'cancel') {
        const deadline = Date.now() + 30_000;
        let ready = false;
        while (Date.now() < deadline) {
          const currentSteps = await db
            .select()
            .from(workflowSteps)
            .where(eq(workflowSteps.jobId, failureJob.id));
          if (currentSteps.some((step) => step.logOutput?.split('\n').includes('CANCEL_READY'))) {
            ready = true;
            break;
          }
          if (agentProcess.exitCode !== null) break;
          await Bun.sleep(100);
        }
        assert(ready, 'Docker job did not reach cancellation checkpoint');
        const response = await fetch(
          `${baseURL}/api/repositories/runner-test/private-test/runs/${failureRun.id}/cancel`,
          { method: 'POST', headers: ownerHeaders },
        );
        assert.equal(response.status, 200, await response.text());
      }
      assert.equal(await agentProcess.exited, 0, `${scenario} runner check failed`);
      const finalRun = await db.query.workflowRuns.findFirst({
        where: eq(workflowRuns.id, failureRun.id),
      });
      assert.equal(finalRun?.status, 'completed');
      assert.equal(finalRun?.conclusion, scenario === 'cancel' ? 'cancelled' : 'failure');
      console.log(`PASS: real runner ${scenario}`);
    } finally {
      if (agentProcess.exitCode === null) {
        agentProcess.kill();
        await agentProcess.exited;
      }
    }
  }
  const [removedRun] = await db
    .insert(workflowRuns)
    .values({
      repositoryId: repo.id,
      workflowId: workflow.id,
      commitSha,
      branch: 'main',
      eventName: 'workflow_dispatch',
      status: 'queued',
    })
    .returning();
  await db.insert(workflowJobs).values({
    runId: removedRun.id,
    name: 'removed runner',
    status: 'queued',
    workflowDefinition: {},
  });
  const heartbeatRequest = () =>
    fetch(`${baseURL}/api/runners/${runner.id}/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${runner.token}` },
    });
  const claimed = await heartbeatRequest();
  assert.equal(claimed.status, 200);
  assert.equal(((await claimed.json()) as { job: { runId: string } }).job.runId, removedRun.id);
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, ownerId));
  const { invalidateCachedUser } = await import('../src/middleware/auth');
  await invalidateCachedUser(ownerId);
  const removed = await fetch(`${baseURL}/api/runners/${runner.id}`, {
    method: 'DELETE',
    headers: dispatchHeaders,
  });
  assert.equal(removed.status, 200, await removed.text());
  assert.equal(
    (await db.query.workflowRuns.findFirst({ where: eq(workflowRuns.id, removedRun.id) }))
      ?.conclusion,
    'failure',
  );
  assert.equal((await heartbeatRequest()).status, 401);
  console.log('PASS: deleting an active runner finalizes its run and revokes its credentials');
} finally {
  server?.stop(true);
  assert(/^runner_e2e_[a-f0-9]{32}$/.test(databaseName));
  await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
  assert(resolve(storagePath).startsWith(resolve(tmpdir()) + sep + 'sigmagit-runner-e2e-'));
  await rm(storagePath, { recursive: true, force: true });
}
process.exit(0);
