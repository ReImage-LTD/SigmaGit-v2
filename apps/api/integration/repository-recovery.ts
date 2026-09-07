import assert from 'node:assert/strict';
import { db, repositories, backgroundTasks } from '@sigmagit/db';
import { eq } from 'drizzle-orm';
import { stageRepositoryStorage } from '../src/lib/repository-storage';
import { getRepoPrefix, putObject, getObject } from '../src/s3';
import { deliverTask, startDeliveryWorker, stopDeliveryWorker } from '../src/workers/deliveries';

export async function checkRepositoryRecovery(baseURL: string, headers: Record<string, string>) {
  await stopDeliveryWorker();
  try {
    let abandonedPrefix = '';
    await assert.rejects(stageRepositoryStorage('abandoned', async owner => {
      abandonedPrefix = getRepoPrefix(owner, 'abandoned');
      await putObject(abandonedPrefix + '/HEAD', 'ref: refs/heads/main\n');
      throw new Error('storage copy failed');
    }, async () => { throw new Error('must not publish'); }), /storage copy failed/);
    const fork = await fetch(`${baseURL}/api/repositories/runner-test/private-test/fork`, { method: 'POST', headers, body: JSON.stringify({ name: 'recovery-fork' }) });
    assert.equal(fork.status, 200, await fork.clone().text());
    const { repo: forkBody } = await fork.json() as { repo: { id: string; visibility: string } };
    assert.equal(forkBody.visibility, 'private');
    const rename = await fetch(`${baseURL}/api/repositories/${forkBody.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'recovery-renamed' }) });
    assert.equal(rename.status, 200, await rename.clone().text());
    const row = await db.query.repositories.findFirst({ where: eq(repositories.id, forkBody.id) });
    assert(row);
    const prefix = getRepoPrefix(row.storageOwnerId, row.name);
    assert(await getObject(prefix + '/HEAD'));
    const deletion = await fetch(`${baseURL}/api/repositories/${forkBody.id}`, { method: 'DELETE', headers });
    assert.equal(deletion.status, 200, await deletion.clone().text());
    assert.equal(await db.query.repositories.findFirst({ where: eq(repositories.id, forkBody.id) }), undefined);
    const cleanup = await db.select().from(backgroundTasks).where(eq(backgroundTasks.kind, 'storage-delete'));
    for (const task of cleanup) { await deliverTask(task); await deliverTask(task); await db.delete(backgroundTasks).where(eq(backgroundTasks.id, task.id)); }
    assert.equal(await getObject(prefix + '/HEAD'), null);
    assert.equal(await getObject(abandonedPrefix + '/HEAD'), null);
    console.log('PASS private forks, rename storage, failed staging and repeatable deferred deletion');
  } finally { startDeliveryWorker(); }
}
