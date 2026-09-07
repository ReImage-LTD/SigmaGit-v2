import { db, backgroundTasks } from '@sigmagit/db';
import { eq } from 'drizzle-orm';
import { requestSignal } from './request-context';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Persist cleanup before writing storage; publish the row and retire cleanup atomically. */
export async function stageRepositoryStorage<T>(name: string,
  prepare: (storageOwnerId: string) => Promise<void>,
  publish: (tx: Transaction, storageOwnerId: string) => Promise<T>): Promise<T> {
  const storageOwnerId = crypto.randomUUID();
  const [cleanup] = await db.insert(backgroundTasks).values({ kind: 'storage-delete', payload: { storageOwnerId, name }, availableAt: new Date(Date.now() + 60 * 60_000) }).returning();
  try {
    await prepare(storageOwnerId);
    requestSignal()?.throwIfAborted();
    return await db.transaction(async tx => {
      const result = await publish(tx, storageOwnerId);
      await tx.delete(backgroundTasks).where(eq(backgroundTasks.id, cleanup.id));
      return result;
    });
  } catch (error) {
    await db.update(backgroundTasks).set({ availableAt: new Date() }).where(eq(backgroundTasks.id, cleanup.id));
    throw error;
  }
}

export async function queueRepositoryDeletion(tx: Transaction, storageOwnerId: string, name: string) {
  await tx.insert(backgroundTasks).values({ kind: 'storage-delete', payload: { storageOwnerId, name } });
}
