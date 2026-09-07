import { db, repositoryWebhooks, backgroundTasks } from '@sigmagit/db';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { claimBackgroundTask, finishBackgroundTask } from '../lib/background-tasks';
import { guardedFetch } from '../security/ssrf';
import { config } from '../config';

export async function deliverTask(task: typeof backgroundTasks.$inferSelect, send = guardedFetch) {
  const hook = await db.query.repositoryWebhooks.findFirst({ where: eq(repositoryWebhooks.id, String(task.payload.webhookId)) });
  if (!hook?.active) return;
  const json = JSON.stringify(task.payload.body);
  const body = hook.contentType === 'form' ? new URLSearchParams({ payload: json }).toString() : json;
  const headers: Record<string, string> = {
    'Content-Type': hook.contentType === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
    'X-SigmaGit-Event': String(task.payload.event), 'X-SigmaGit-Delivery': task.id,
  };
  if (hook.secret) headers['X-Hub-Signature-256'] = 'sha256=' + createHmac('sha256', hook.secret).update(body).digest('hex');
  const response = await send(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000), requireHttps: config.isProduction });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
}

let timer: ReturnType<typeof setInterval> | undefined;
let active: Promise<void> | undefined;
export function startDeliveryWorker() {
  if (timer) return;
  timer = setInterval(() => {
    if (active) return;
    active = Promise.all(Array.from({ length: 4 }, async () => {
      const task = await claimBackgroundTask(config.webhooksEnabled);
      if (!task) return;
      try { await deliverTask(task); await finishBackgroundTask(task); }
      catch (error) { await finishBackgroundTask(task, error); }
    })).then(() => {}).catch(error => console.error('[Delivery] Worker failed', error)).finally(() => { active = undefined; });
  }, 1000);
  timer.unref();
}
export async function stopDeliveryWorker() {
  clearInterval(timer); timer = undefined;
  await active;
}
