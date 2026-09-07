import assert from 'node:assert/strict';
import { db, backgroundTasks, repositoryWebhooks } from '@sigmagit/db';
import { eq } from 'drizzle-orm';
import { claimBackgroundTask, finishBackgroundTask } from '../src/lib/background-tasks';
import { deliverTask, stopDeliveryWorker, startDeliveryWorker } from '../src/workers/deliveries';
import { deliverWebhookEvent } from '../src/routes/repo-webhooks';

export async function checkBackgroundTasks(repositoryId: string, createdById: string) {
  await stopDeliveryWorker();
  const [hook] = await db.insert(repositoryWebhooks).values({ repositoryId, createdById, url: 'https://example.invalid/hook', events: ['push'], secret: 'integration-only' }).returning();
  try {
    await deliverWebhookEvent(repositoryId, 'push', { ref: 'main' });
    const claims = (await Promise.all([claimBackgroundTask(), claimBackgroundTask()])).filter(row => row !== undefined);
    assert.equal(claims.length, 1);
    const task = claims[0];
    let deliveryId: string | null = null;
    await assert.rejects(deliverTask(task, async (_url, options) => {
      deliveryId = new Headers(options?.headers).get('X-SigmaGit-Delivery');
      return new Response('unavailable', { status: 503 });
    }), /HTTP 503/);
    await finishBackgroundTask(task, new Error('503'));
    await db.update(backgroundTasks).set({ availableAt: new Date(0) }).where(eq(backgroundTasks.id, task.id));
    const retry = await claimBackgroundTask();
    assert(retry); assert.equal(retry.id, deliveryId); assert.equal(retry.attempts, 2);
    await finishBackgroundTask(task); // Stale owner must not complete the retry.
    assert.equal((await db.query.backgroundTasks.findFirst({ where: eq(backgroundTasks.id, task.id) }))?.state, 'processing');
    await deliverTask(retry, async () => new Response(null, { status: 204 }));
    await finishBackgroundTask(retry);
    assert.equal((await db.query.backgroundTasks.findFirst({ where: eq(backgroundTasks.id, task.id) }))?.state, 'completed');
    await db.delete(backgroundTasks).where(eq(backgroundTasks.id, task.id));
    console.log('PASS durable webhook retries preserve delivery IDs and reject stale completions');
  } finally {
    await db.delete(repositoryWebhooks).where(eq(repositoryWebhooks.id, hook.id));
    startDeliveryWorker();
  }
}
