import { createMiddleware } from 'hono/factory';
import { db, runners } from '@sigmagit/db';
import { and, eq } from 'drizzle-orm';

export type RunnerVariables = {
  runner: { id: string; name: string; status: string };
};

export const requireRunnerAuth = createMiddleware<{ Variables: RunnerVariables }>(
  async (c, next) => {
    const runnerId = c.req.param('runnerId');
    const authHeader = c.req.header('authorization');
    const token = authHeader?.match(/^Bearer (RUNNER_[a-f0-9]{64})$/)?.[1];
    if (c.get('runner')?.id === runnerId) {
      await next();
      return;
    }

    if (!runnerId || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(runnerId) || !token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const [runner] = await db
      .select({ id: runners.id, name: runners.name, status: runners.status })
      .from(runners)
      .where(and(eq(runners.id, runnerId), eq(runners.token, token)))
      .limit(1);

    if (!runner) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    c.set('runner', runner);
    await next();
  },
);
