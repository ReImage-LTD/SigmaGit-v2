import { db, backgroundTasks } from '@sigmagit/db';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';

export async function claimBackgroundTask(webhooksEnabled = true) {
  return db.transaction(async tx => {
    const [task] = await tx.select().from(backgroundTasks).where(and(
      webhooksEnabled ? undefined : eq(backgroundTasks.kind, 'storage-delete'),
      or(and(eq(backgroundTasks.state, 'pending'), lt(backgroundTasks.availableAt, new Date())),
        and(eq(backgroundTasks.state, 'processing'), lt(backgroundTasks.leaseUntil, new Date()))),
    )).orderBy(asc(backgroundTasks.availableAt), asc(backgroundTasks.id)).limit(1).for('update', { skipLocked: true });
    if (!task) return;
    const [claimed] = await tx.update(backgroundTasks).set({ state: 'processing', attempts: sql`${backgroundTasks.attempts} + 1`, claimToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 60_000), updatedAt: new Date() })
      .where(eq(backgroundTasks.id, task.id)).returning();
    return claimed;
  });
}

export async function finishBackgroundTask(task: typeof backgroundTasks.$inferSelect, error?: unknown) {
  await db.update(backgroundTasks).set({
    state: error ? (task.attempts >= 8 ? 'failed' : 'pending') : 'completed',
    availableAt: new Date(Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(task.attempts - 1, 6))),
    leaseUntil: null, claimToken: null, updatedAt: new Date(),
    lastError: error ? 'Delivery failed; retry scheduled or attempts exhausted' : null,
  }).where(and(eq(backgroundTasks.id, task.id), eq(backgroundTasks.claimToken, task.claimToken!), eq(backgroundTasks.state, 'processing')));
}
