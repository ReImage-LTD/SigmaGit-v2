import { db, runners, workflowJobs, workflowRuns } from '@sigmagit/db';
import { and, eq, inArray, ne } from 'drizzle-orm';

// Runner credentials grant read access only to repositories with an active
// assignment. They never authenticate as a user or grant Git push access.
export async function canRunnerReadRepository(repositoryId: string, authorization?: string) {
  const token = authorization?.match(/^Bearer (RUNNER_[a-f0-9]{64})$/)?.[1];
  if (!token) return false;
  const [assignment] = await db
    .select({ id: workflowJobs.id })
    .from(workflowJobs)
    .innerJoin(runners, eq(runners.id, workflowJobs.runnerId))
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowJobs.runId))
    .where(
      and(
        eq(runners.token, token),
        eq(workflowRuns.repositoryId, repositoryId),
        inArray(workflowJobs.status, ['assigned', 'in_progress']),
        ne(workflowRuns.status, 'completed'),
      ),
    )
    .limit(1);
  return Boolean(assignment);
}
