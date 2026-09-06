import {
  db,
  repositories,
  runners,
  sessions,
  workflowJobs,
  workflowRuns,
  workflowSteps,
} from '@sigmagit/db';
import { checkRunnerHealth } from '../src/workers/runner-health';
import { getAllowedOrigins } from '../src/config';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

interface Fixture {
  baseURL: string;
  ownerId: string;
  repositoryId: string;
  workflowId: string;
  commitSha: string;
}

export async function checkRunnerProtocol(fixture: Fixture) {
  const { baseURL, ownerId, repositoryId, workflowId, commitSha } = fixture;
  const [first] = await db.select().from(runners);
  assert(first);
  const [second] = await db
    .insert(runners)
    .values({
      name: 'second',
      token: `RUNNER_${'a'.repeat(64)}`,
      status: 'online',
      lastSeenAt: new Date(),
    })
    .returning();
  const request = (runner: typeof first, path: string, body?: unknown) =>
    fetch(`${baseURL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${runner.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await request(first, '/api/runners')).status, 403);
  assert.equal((await request(first, '/api/admin/stats')).status, 403);
  assert.equal((await request(second, `/api/runners/${first.id}/heartbeat`, {})).status, 401);
  const seedRun = async () => {
    const [run] = await db
      .insert(workflowRuns)
      .values({
        repositoryId,
        workflowId,
        commitSha,
        branch: 'main',
        eventName: 'workflow_dispatch',
        status: 'queued',
      })
      .returning();
    const [job] = await db
      .insert(workflowJobs)
      .values({ runId: run.id, name: 'protocol', status: 'queued', workflowDefinition: {} })
      .returning();
    return { run, job };
  };
  const one = await seedRun();
  const two = await seedRun();
  const assignments = await Promise.all(
    [first, second].map(async (runner) => {
      const response = await request(runner, `/api/runners/${runner.id}/heartbeat`, {});
      assert.equal(response.status, 200);
      const result = (await response.json()) as { job: { id: string; runId: string } };
      return { runner, job: result.job };
    }),
  );
  assert.notEqual(
    assignments[0].job.id,
    assignments[1].job.id,
    'concurrent runners claimed the same job',
  );
  assert.deepEqual(
    new Set(assignments.map((value) => value.job.id)),
    new Set([one.job.id, two.job.id]),
  );
  const active = assignments[0];
  const path = `/api/runners/${first.id}/jobs/${active.job.id}`;
  assert.equal(
    (await request(second, `/api/runners/${second.id}/jobs/${active.job.id}/progress`, {})).status,
    404,
  );
  assert.equal(
    (await request(first, '/runner-test/private-test.git/info/refs?service=git-receive-pack'))
      .status,
    401,
  );
  const [otherRepo] = await db
    .insert(repositories)
    .values({ ownerId, storageOwnerId: ownerId, name: 'other-private', visibility: 'private' })
    .returning();
  assert.equal(
    (await request(first, '/runner-test/other-private.git/info/refs?service=git-upload-pack'))
      .status,
    401,
  );
  const updates = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      request(first, `${path}/progress`, {
        stepName: 'parallel',
        stepNumber: 1,
        status: 'in_progress',
        logChunk: `chunk-${index}\n`,
      }),
    ),
  );
  assert(updates.every((response) => response.status === 200));
  const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.jobId, active.job.id));
  assert.equal(steps.length, 1, 'parallel progress created duplicate steps');
  for (let index = 0; index < 8; index++) assert(steps[0].logOutput?.includes(`chunk-${index}\n`));

  // Age of the job alone must not kill a runner that is still heartbeating.
  await db
    .update(workflowJobs)
    .set({ startedAt: new Date(Date.now() - 60 * 60 * 1000) })
    .where(eq(workflowJobs.id, active.job.id));
  await checkRunnerHealth();
  assert.equal(
    (await db.query.workflowJobs.findFirst({ where: eq(workflowJobs.id, active.job.id) }))?.status,
    'in_progress',
  );

  // Authenticate through Better Auth's real session middleware, not a test bypass.
  const token = crypto.randomUUID();
  await db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      userId: ownerId,
      token,
      expiresAt: new Date(Date.now() + 60_000),
    });
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!)
    .update(token)
    .digest('base64');
  const ownerHeaders = {
    origin: getAllowedOrigins()[0],
    cookie: `sigmagit_dev.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  };
  const cancel = (repoName: string) =>
    fetch(`${baseURL}/api/repositories/runner-test/${repoName}/runs/${active.job.runId}/cancel`, {
      method: 'POST',
      headers: ownerHeaders,
    });
  assert.equal(
    (await cancel(otherRepo.name)).status,
    404,
    'cross-repository cancellation must be rejected',
  );
  assert.equal(
    (await db.query.workflowJobs.findFirst({ where: eq(workflowJobs.id, active.job.id) }))?.status,
    'in_progress',
  );
  const cancelled = await cancel('private-test');
  assert.equal(cancelled.status, 200, await cancelled.text());
  const keepalive = await request(first, `/api/runners/${first.id}/heartbeat`, {
    jobId: active.job.id,
  });
  assert.equal(keepalive.status, 200);
  assert.equal(((await keepalive.json()) as { cancelled: boolean }).cancelled, true);
  assert.equal(
    (
      await request(first, `${path}/complete`, {
        status: 'completed',
        conclusion: 'success',
        steps: [],
      })
    ).status,
    409,
  );
  assert.equal(
    (await db.query.workflowRuns.findFirst({ where: eq(workflowRuns.id, active.job.runId) }))
      ?.conclusion,
    'cancelled',
  );
  assert.equal(
    (await request(first, '/runner-test/private-test.git/info/refs?service=git-upload-pack'))
      .status,
    401,
  );

  // A lost runner must finish its parent run as well as the job.
  await db
    .update(runners)
    .set({ lastSeenAt: new Date(Date.now() - 180_000) })
    .where(eq(runners.id, second.id));
  await checkRunnerHealth();
  const lost = await db.query.workflowRuns.findFirst({
    where: eq(workflowRuns.id, assignments[1].job.runId),
  });
  assert.equal(lost?.status, 'completed');
  assert.equal(lost?.conclusion, 'failure');
  assert.equal(
    (await db.query.runners.findFirst({ where: eq(runners.id, second.id) }))?.currentJobId,
    null,
  );
  assert.equal(
    (
      await db
        .select()
        .from(workflowJobs)
        .where(and(eq(workflowJobs.runnerId, second.id), eq(workflowJobs.status, 'failed')))
    ).length,
    1,
  );
  console.log(
    'PASS: concurrent assignment and logs, authorization boundaries, cancellation, healthy long jobs, and offline-run finalization',
  );
  return { runner: first, ownerHeaders };
}
