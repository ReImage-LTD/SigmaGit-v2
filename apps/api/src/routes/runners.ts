import {
  db,
  repositories,
  organizations,
  repositoryCollaborators,
  runners,
  users,
  workflowJobs,
  workflowRuns,
  workflowSteps,
} from '@sigmagit/db';
import { authMiddleware, requireAdmin, type AuthVariables } from '../middleware/auth';
import { requireRunnerAuth, type RunnerVariables } from '../middleware/runner-auth';
import { and, eq, isNull, asc, or, inArray, ne } from 'drizzle-orm';
import { formatZodError } from '../middleware/validate';
import { logSecurityEvent } from '../security/audit';
import { secureCompare } from '../security/secrets';
import { notifyUsers } from '../websocket';
import { config } from '../config';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

type Variables = AuthVariables & RunnerVariables;

const app = new Hono<{ Variables: Variables }>();

function authorizeRunnerRegistration(c: {
  req: { header: (name: string) => string | undefined };
  get: (key: string) => AuthUser | null;
}): boolean {
  const secret = config.runnerRegistrationSecret;
  if (!secret) {
    return !config.isProduction;
  }
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const provided = authHeader.slice(7);
    if (secureCompare(provided, secret)) return true;
  }
  const user = c.get('user');
  return user?.role === 'admin';
}

type AuthUser = AuthVariables['user'];

const runnerRegisterSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    labels: z.array(z.string().max(64)).max(32).optional(),
    os: z.string().max(64).optional(),
    arch: z.string().max(64).optional(),
    version: z.string().max(64).optional(),
  })
  .strict();

app.post('/api/runners/register', async (c) => {
  if (!authorizeRunnerRegistration(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = runnerRegisterSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { name, labels, os, arch, version } = parsed.data;

  const token = `RUNNER_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;

  const [runner] = await db
    .insert(runners)
    .values({
      name,
      token,
      labels: labels ?? [],
      status: 'online',
      lastSeenAt: new Date(),
      ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
      os: os ?? null,
      arch: arch ?? null,
      version: version ?? null,
    })
    .returning({ id: runners.id });

  console.log(`[Runners] Registered runner: ${name} (${runner.id})`);
  logSecurityEvent({
    action: 'runner.register',
    targetType: 'runner',
    targetId: runner.id,
    outcome: 'success',
    meta: { name },
  });

  return c.json({ id: runner.id, token });
});

// ─── Heartbeat — poll for jobs ─────────────────────────────────────────────────

app.post('/api/runners/:runnerId/heartbeat', requireRunnerAuth, async (c) => {
  const runner = c.get('runner');
  const parsed = z
    .object({ jobId: z.string().uuid().optional() })
    .strict()
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid heartbeat' }, 400);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [lockedRunner] = await tx
      .select({ id: runners.id })
      .from(runners)
      .where(eq(runners.id, runner.id))
      .for('update');
    if (!lockedRunner) return null;
    await tx
      .update(runners)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(eq(runners.id, runner.id));
    const activeConditions = or(
      eq(workflowJobs.status, 'assigned'),
      eq(workflowJobs.status, 'in_progress'),
    );
    if (parsed.data.jobId) {
      const [active] = await tx
        .select({ id: workflowJobs.id })
        .from(workflowJobs)
        .where(
          and(
            eq(workflowJobs.id, parsed.data.jobId),
            eq(workflowJobs.runnerId, runner.id),
            activeConditions,
          ),
        )
        .limit(1);
      return { job: null, cancelled: !active };
    }
    const [existing] = await tx
      .select()
      .from(workflowJobs)
      .where(and(eq(workflowJobs.runnerId, runner.id), activeConditions))
      .limit(1);
    const [next] = existing
      ? [existing]
      : await tx
          .select()
          .from(workflowJobs)
          .where(
            and(
              eq(workflowJobs.status, 'queued'),
              isNull(workflowJobs.runnerId),
              inArray(
                workflowJobs.runId,
                tx
                  .select({ id: workflowRuns.id })
                  .from(workflowRuns)
                  .where(ne(workflowRuns.status, 'completed')),
              ),
            ),
          )
          .orderBy(asc(workflowJobs.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
    if (!next) {
      await tx
        .update(runners)
        .set({ status: 'online', currentJobId: null })
        .where(eq(runners.id, runner.id));
      return { job: null };
    }
    const [run] = await tx
      .select({
        id: workflowRuns.id,
        status: workflowRuns.status,
        commitSha: workflowRuns.commitSha,
        branch: workflowRuns.branch,
        eventName: workflowRuns.eventName,
        eventPayload: workflowRuns.eventPayload,
        repoOwner: users.username,
        orgName: organizations.name,
        repoName: repositories.name,
      })
      .from(workflowRuns)
      .innerJoin(repositories, eq(repositories.id, workflowRuns.repositoryId))
      .innerJoin(users, eq(users.id, repositories.ownerId))
      .leftJoin(organizations, eq(organizations.id, repositories.organizationId))
      .where(eq(workflowRuns.id, next.runId))
      .limit(1);
    if (!run || run.status === 'completed') return { job: null };
    await tx
      .update(workflowJobs)
      .set({ runnerId: runner.id, status: 'assigned', startedAt: now })
      .where(eq(workflowJobs.id, next.id));
    await tx
      .update(workflowRuns)
      .set({ status: 'in_progress', startedAt: now })
      .where(and(eq(workflowRuns.id, next.runId), eq(workflowRuns.status, 'queued')));
    await tx
      .update(runners)
      .set({ status: 'busy', currentJobId: next.id })
      .where(eq(runners.id, runner.id));
    return {
      job: {
        id: next.id,
        runId: next.runId,
        name: next.name,
        workflowDefinition: next.workflowDefinition,
        commitSha: run.commitSha,
        branch: run.branch,
        eventName: run.eventName,
        eventPayload: run.eventPayload,
        repoOwner: run.orgName ?? run.repoOwner,
        repoName: run.repoName,
      },
    };
  });
  if (!result) return c.json({ error: 'Runner not found' }, 401);
  return c.json(result);
});

const MAX_STEP_LOG_BYTES = 1 * 1024 * 1024; // 1MB cumulative log per step
const MAX_LOG_CHUNK_BYTES = 64 * 1024; // 64KB per progress chunk
const runnerProgressSchema = z
  .object({
    stepName: z.string().trim().min(1).max(200).optional(),
    stepNumber: z.number().int().min(0).max(10_000).optional(),
    status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'cancelled']).optional(),
    logChunk: z.string().optional(),
    exitCode: z.number().int().min(-255).max(255).optional(),
  })
  .strict()
  .refine((value) => (value.stepName === undefined) === (value.stepNumber === undefined), {
    message: 'stepName and stepNumber must be provided together',
  });
const runnerCompleteSchema = z
  .object({
    status: z.enum(['completed', 'failed']).default('completed'),
    conclusion: z.enum(['success', 'failure', 'cancelled', 'skipped']).nullable().optional(),
    steps: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200),
            number: z.number().int().min(0).max(10_000),
            exitCode: z.number().int().min(-255).max(255).optional(),
            logOutput: z.string().optional(),
            status: z.enum(['completed', 'failed', 'cancelled']).optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();

// ─── Progress — streaming step updates ─────────────────────────────────────────

app.post('/api/runners/:runnerId/jobs/:jobId/progress', requireRunnerAuth, async (c) => {
  const runner = c.get('runner')!;
  const jobId = c.req.param('jobId');
  const parsed = runnerProgressSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: formatZodError(parsed.error) }, 400);
  const { stepName, stepNumber, status, logChunk, exitCode } = parsed.data;

  const failure = await db.transaction(async (tx) => {
    // Ensure this job is assigned to the authenticated runner.
    const [ownedJob] = await tx
      .select({
        id: workflowJobs.id,
        runnerId: workflowJobs.runnerId,
        status: workflowJobs.status,
        conclusion: workflowJobs.conclusion,
      })
      .from(workflowJobs)
      .where(eq(workflowJobs.id, jobId))
      .limit(1)
      .for('update');
    if (!ownedJob || ownedJob.runnerId !== runner.id) {
      return c.json({ error: 'Job not found' }, 404);
    }
    if (ownedJob.status !== 'assigned' && ownedJob.status !== 'in_progress') {
      return c.json({ error: 'Job is not accepting progress updates' }, 409);
    }
    if (logChunk != null && Buffer.byteLength(logChunk, 'utf8') > MAX_LOG_CHUNK_BYTES) {
      return c.json({ error: 'logChunk too large' }, 413);
    }

    const now = new Date();

    // Mark job as in_progress if needed
    const progressed = await tx
      .update(workflowJobs)
      .set({ status: 'in_progress' })
      .where(
        and(
          eq(workflowJobs.id, jobId),
          eq(workflowJobs.runnerId, runner.id),
          or(eq(workflowJobs.status, 'assigned'), eq(workflowJobs.status, 'in_progress')),
        ),
      )
      .returning({ id: workflowJobs.id });
    if (progressed.length !== 1) return c.json({ error: 'Job state changed' }, 409);

    // Upsert step record
    if (stepName && stepNumber != null) {
      const existingStep = await tx.query.workflowSteps.findFirst({
        where: and(eq(workflowSteps.jobId, jobId), eq(workflowSteps.number, stepNumber)),
      });

      if (existingStep) {
        let nextLog = existingStep.logOutput ?? '';
        if (logChunk) {
          nextLog = nextLog + logChunk;
          if (Buffer.byteLength(nextLog, 'utf8') > MAX_STEP_LOG_BYTES) {
            return c.json({ error: 'Step log limit exceeded' }, 413);
          }
        }
        await tx
          .update(workflowSteps)
          .set({
            status: status ?? existingStep.status,
            exitCode: exitCode ?? existingStep.exitCode,
            logOutput: logChunk ? nextLog : existingStep.logOutput,
            ...(status === 'in_progress' && !existingStep.startedAt ? { startedAt: now } : {}),
            ...(status === 'completed' || status === 'failed' ? { completedAt: now } : {}),
          })
          .where(eq(workflowSteps.id, existingStep.id));
      } else {
        await tx.insert(workflowSteps).values({
          jobId,
          number: stepNumber,
          name: stepName,
          status: status ?? 'in_progress',
          exitCode: exitCode ?? null,
          logOutput: logChunk ?? null,
          startedAt: status === 'in_progress' ? now : null,
        });
      }
    }
  });
  if (failure) return failure;

  // Notify subscribed users via WebSocket (best-effort); include repoOwner/repoName/runId for client cache invalidation
  try {
    const [run] = await db
      .select({
        triggeredBy: workflowRuns.triggeredBy,
        repositoryId: workflowRuns.repositoryId,
        runId: workflowRuns.id,
        repoOwner: users.username,
        repoName: repositories.name,
        repoOwnerId: users.id,
      })
      .from(workflowJobs)
      .innerJoin(workflowRuns, eq(workflowRuns.id, workflowJobs.runId))
      .innerJoin(repositories, eq(repositories.id, workflowRuns.repositoryId))
      .innerJoin(users, eq(users.id, repositories.ownerId))
      .where(eq(workflowJobs.id, jobId))
      .limit(1);

    if (run) {
      const payload = {
        type: 'workflow_job.log_chunk',
        jobId,
        runId: run.runId,
        repoOwner: run.repoOwner,
        repoName: run.repoName,
        stepNumber,
        stepName,
        logChunk,
        status,
      };
      const collaborators = await db
        .select({ userId: repositoryCollaborators.userId })
        .from(repositoryCollaborators)
        .where(eq(repositoryCollaborators.repositoryId, run.repositoryId));
      const recipientIds = new Set<string>(collaborators.map((c) => c.userId));
      if (run.triggeredBy) recipientIds.add(run.triggeredBy);
      if (run.repoOwnerId) recipientIds.add(run.repoOwnerId);
      notifyUsers(Array.from(recipientIds), payload);
    }
  } catch {
    // Non-critical
  }

  return c.json({ success: true });
});

// ─── Complete — job finished ────────────────────────────────────────────────────

app.post('/api/runners/:runnerId/jobs/:jobId/complete', requireRunnerAuth, async (c) => {
  const runner = c.get('runner')!;
  const jobId = c.req.param('jobId');
  const parsed = runnerCompleteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: formatZodError(parsed.error) }, 400);
  const { status, conclusion, steps } = parsed.data;

  const now = new Date();
  const failure = await db.transaction(async (tx) => {
    await tx
      .select({ id: runners.id })
      .from(runners)
      .where(eq(runners.id, runner.id))
      .for('update');
    // Ensure this job is assigned to the authenticated runner.
    const [ownedJob] = await tx
      .select({
        id: workflowJobs.id,
        runnerId: workflowJobs.runnerId,
        status: workflowJobs.status,
        conclusion: workflowJobs.conclusion,
      })
      .from(workflowJobs)
      .where(eq(workflowJobs.id, jobId))
      .limit(1)
      .for('update');
    if (!ownedJob || ownedJob.runnerId !== runner.id) {
      return c.json({ error: 'Job not found' }, 404);
    }
    if (ownedJob.status !== 'assigned' && ownedJob.status !== 'in_progress') {
      return ownedJob.status === status && ownedJob.conclusion === (conclusion ?? null)
        ? undefined
        : c.json({ error: 'Job is already terminal' }, 409);
    }
    if (
      steps?.some(
        (step) => step.logOutput && Buffer.byteLength(step.logOutput, 'utf8') > MAX_STEP_LOG_BYTES,
      )
    ) {
      return c.json({ error: 'Step log limit exceeded' }, 413);
    }

    // Update job
    const completed = await tx
      .update(workflowJobs)
      .set({
        status,
        conclusion: conclusion ?? null,
        completedAt: now,
      })
      .where(
        and(
          eq(workflowJobs.id, jobId),
          eq(workflowJobs.runnerId, runner.id),
          or(eq(workflowJobs.status, 'assigned'), eq(workflowJobs.status, 'in_progress')),
        ),
      )
      .returning({ id: workflowJobs.id });
    if (completed.length !== 1) return c.json({ error: 'Job state changed' }, 409);

    // Bulk upsert step records
    if (steps && steps.length > 0) {
      for (const step of steps) {
        const existing = await tx.query.workflowSteps.findFirst({
          where: and(eq(workflowSteps.jobId, jobId), eq(workflowSteps.number, step.number)),
        });

        if (existing) {
          await tx
            .update(workflowSteps)
            .set({
              status: step.status ?? 'completed',
              exitCode: step.exitCode ?? existing.exitCode,
              logOutput: step.logOutput ?? existing.logOutput,
              completedAt: now,
            })
            .where(eq(workflowSteps.id, existing.id));
        } else {
          await tx.insert(workflowSteps).values({
            jobId,
            number: step.number,
            name: step.name,
            status: step.status ?? 'completed',
            exitCode: step.exitCode ?? null,
            logOutput: step.logOutput ?? null,
            completedAt: now,
          });
        }
      }
    }

    // Clear runner state
    await tx
      .update(runners)
      .set({ status: 'online', currentJobId: null, updatedAt: now })
      .where(eq(runners.id, runner.id));
  });
  if (failure) return failure;

  // Check if all jobs in the run are done → finalize workflow_runs
  const [job] = await db
    .select({ runId: workflowJobs.runId })
    .from(workflowJobs)
    .where(eq(workflowJobs.id, jobId))
    .limit(1);

  if (job?.runId) {
    await finalizeRunIfComplete(job.runId, now);

    // Notify via WebSocket; include repoOwner/repoName so client can invalidate workflow-run and workflow-runs
    try {
      const [run] = await db
        .select({
          triggeredBy: workflowRuns.triggeredBy,
          repositoryId: workflowRuns.repositoryId,
          repoOwner: users.username,
          repoName: repositories.name,
          repoOwnerId: users.id,
        })
        .from(workflowRuns)
        .innerJoin(repositories, eq(repositories.id, workflowRuns.repositoryId))
        .innerJoin(users, eq(users.id, repositories.ownerId))
        .where(eq(workflowRuns.id, job.runId))
        .limit(1);

      if (run) {
        const payload = {
          type: 'workflow_job.status_changed',
          jobId,
          runId: job.runId,
          repoOwner: run.repoOwner,
          repoName: run.repoName,
          status,
          conclusion,
        };
        const collaborators = await db
          .select({ userId: repositoryCollaborators.userId })
          .from(repositoryCollaborators)
          .where(eq(repositoryCollaborators.repositoryId, run.repositoryId));
        const recipientIds = new Set<string>(collaborators.map((c) => c.userId));
        if (run.triggeredBy) recipientIds.add(run.triggeredBy);
        if (run.repoOwnerId) recipientIds.add(run.repoOwnerId);
        notifyUsers(Array.from(recipientIds), payload);
      }
    } catch {
      // Non-critical
    }
  }

  console.log(
    `[Runners] Job ${jobId} completed with ${conclusion ?? status} by runner ${runner.id}`,
  );

  return c.json({ success: true });
});

export async function finalizeRunIfComplete(runId: string, now: Date) {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .for('update');
    if (!run || run.status === 'completed') return;
    const allJobs = await tx
      .select({ status: workflowJobs.status, conclusion: workflowJobs.conclusion })
      .from(workflowJobs)
      .where(eq(workflowJobs.runId, runId));

    const pending = allJobs.filter(
      (j) => j.status === 'queued' || j.status === 'assigned' || j.status === 'in_progress',
    );

    if (pending.length > 0) return;

    const anyFailed = allJobs.some((j) => j.conclusion === 'failure' || j.status === 'failed');
    const anyCancelled = allJobs.some(
      (j) => j.conclusion === 'cancelled' || j.status === 'cancelled',
    );

    await tx
      .update(workflowRuns)
      .set({
        status: 'completed',
        conclusion: anyFailed ? 'failure' : anyCancelled ? 'cancelled' : 'success',
        completedAt: now,
      })
      .where(eq(workflowRuns.id, runId));
  });
}

// ─── Admin endpoints ───────────────────────────────────────────────────────────

app.get('/api/runners', requireAdmin, async (c) => {
  const rows = await db
    .select({
      id: runners.id,
      name: runners.name,
      status: runners.status,
      labels: runners.labels,
      os: runners.os,
      arch: runners.arch,
      version: runners.version,
      lastSeenAt: runners.lastSeenAt,
      currentJobId: runners.currentJobId,
      ipAddress: runners.ipAddress,
      createdAt: runners.createdAt,
      currentRunId: workflowRuns.id,
      repoOwner: users.username,
      repoName: repositories.name,
    })
    .from(runners)
    .leftJoin(workflowJobs, eq(workflowJobs.id, runners.currentJobId))
    .leftJoin(workflowRuns, eq(workflowRuns.id, workflowJobs.runId))
    .leftJoin(repositories, eq(repositories.id, workflowRuns.repositoryId))
    .leftJoin(users, eq(users.id, repositories.ownerId))
    .orderBy(runners.createdAt);

  let jobStats: Array<{ runnerId: string; total: number; success: number }> = [];
  if (rows.length > 0) {
    const raw = await db.execute(sql`
      SELECT runner_id as "runnerId",
        count(*)::int as total,
        count(*) FILTER (WHERE conclusion = 'success')::int as success
      FROM workflow_jobs
      WHERE runner_id IS NOT NULL
        AND status IN ('completed', 'failed', 'cancelled')
      GROUP BY runner_id
    `);
    const rawRows = Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? []);
    jobStats = rawRows as Array<{ runnerId: string; total: number; success: number }>;
  }

  const countMap = new Map<string, { total: number; success: number }>();
  for (const row of jobStats) {
    if (row.runnerId) countMap.set(row.runnerId, { total: row.total, success: row.success });
  }

  const runnersList = rows.map((r) => {
    const counts = r.id ? countMap.get(r.id) : null;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      labels: r.labels,
      os: r.os,
      arch: r.arch,
      version: r.version,
      lastSeenAt: r.lastSeenAt,
      currentJobId: r.currentJobId,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
      ...(r.currentJobId && r.currentRunId && r.repoOwner && r.repoName
        ? { currentRunId: r.currentRunId, repoOwner: r.repoOwner, repoName: r.repoName }
        : {}),
      ...(counts
        ? {
            jobsRunCount: counts.total,
            jobsSuccessCount: counts.success,
            successRate:
              counts.total > 0 ? Math.round((counts.success / counts.total) * 100) : null,
          }
        : {}),
    };
  });

  return c.json({ runners: runnersList });
});

app.delete('/api/runners/:runnerId', authMiddleware, requireAdmin, async (c) => {
  const runnerId = c.req.param('runnerId');
  const now = new Date();

  // Fail any active jobs
  const failedJobs = await db.transaction(async (tx) => {
    await tx.select({ id: runners.id }).from(runners).where(eq(runners.id, runnerId)).for('update');
    const failed = await tx
      .update(workflowJobs)
      .set({ status: 'failed', conclusion: 'failure', completedAt: now })
      .where(
        and(
          eq(workflowJobs.runnerId, runnerId),
          or(eq(workflowJobs.status, 'assigned'), eq(workflowJobs.status, 'in_progress')),
        ),
      )
      .returning({ runId: workflowJobs.runId });
    await tx.delete(runners).where(eq(runners.id, runnerId));
    return failed;
  });

  for (const runId of new Set(failedJobs.map((job) => job.runId)))
    await finalizeRunIfComplete(runId, now);

  return c.json({ success: true });
});

export default app;
