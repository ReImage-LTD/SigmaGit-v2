/**
 * Trigger a workflow run for a repository event.
 *
 * Queries active workflows matching the event, creates workflow_runs and
 * workflow_jobs rows in "queued" state. Runners pick them up via heartbeat.
 */
import { db, workflows, workflowRuns, workflowJobs } from '@sigmagit/db';
import { eq, and } from 'drizzle-orm';

type TriggerEvent = 'push' | 'pull_request' | 'workflow_dispatch';

interface TriggerOptions {
  repoId: string;
  branch: string;
  commitSha: string;
  eventName: TriggerEvent;
  eventPayload?: Record<string, unknown>;
  triggeredBy?: string;
  /** For workflow_dispatch — only trigger a specific workflow */
  workflowId?: string;
}

function branchMatches(branch: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => {
    if (pattern === '*' || pattern === '**') return true;
    if (pattern.endsWith('*')) return branch.startsWith(pattern.slice(0, -1));
    return branch === pattern;
  });
}

export async function triggerWorkflows(options: TriggerOptions): Promise<string[]> {
  const {
    repoId,
    branch,
    commitSha,
    eventName,
    eventPayload = {},
    triggeredBy,
    workflowId,
  } = options;

  const runIds: string[] = [];

  try {
    // Query active workflows for this repo
    const query = workflowId
      ? [
          await db.query.workflows.findFirst({
            where: and(
              eq(workflows.id, workflowId),
              eq(workflows.repositoryId, repoId),
              eq(workflows.active, true),
            ),
          }),
        ]
      : await db.query.workflows.findMany({
          where: and(eq(workflows.repositoryId, repoId), eq(workflows.active, true)),
        });

    for (const workflow of query) {
      if (!workflow) continue;

      // Check trigger matching (skip for workflow_dispatch)
      if (eventName !== 'workflow_dispatch') {
        const triggers = workflow.triggers ?? {};
        if (eventName === 'push') {
          if (!triggers.push) continue;
          if (!branchMatches(branch, triggers.push.branches)) continue;
        } else if (eventName === 'pull_request') {
          if (!triggers.pull_request) continue;
          if (!branchMatches(branch, triggers.pull_request.branches)) continue;
        }
      } else {
        const triggers = workflow.triggers ?? {};
        if (!triggers.workflow_dispatch) continue;
      }

      const parsed: unknown = Bun.YAML.parse(workflow.content);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !('jobs' in parsed) ||
        !parsed.jobs ||
        typeof parsed.jobs !== 'object' ||
        Object.keys(parsed.jobs).length === 0
      ) {
        throw new Error('Workflow has no jobs');
      }
      // Keep the DAG in one act execution: needs, outputs and matrices must
      // share a planner rather than rerunning dependencies in separate agents.
      const run = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(workflowRuns)
          .values({
            workflowId: workflow.id,
            repositoryId: repoId,
            triggeredBy: triggeredBy ?? null,
            commitSha,
            branch,
            eventName,
            eventPayload,
            status: 'queued',
          })
          .returning({ id: workflowRuns.id });
        await tx.insert(workflowJobs).values({
          runId: created.id,
          name: workflow.name,
          workflowDefinition: {
            executionMode: 'workflow',
            workflowContent: workflow.content,
            workflowPath: workflow.path,
          },
          status: 'queued',
        });
        return created;
      });
      runIds.push(run.id);

      console.log(
        `[Workflows] Triggered workflow "${workflow.name}" (run: ${run.id}) for ${eventName} on ${branch}`,
      );
    }
  } catch (err) {
    console.error('[Workflows] triggerWorkflows error:', err);
  }

  return runIds;
}
