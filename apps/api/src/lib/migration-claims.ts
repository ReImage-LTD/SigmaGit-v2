import { db, repositoryMigrations } from '@sigmagit/db';
import { and, asc, eq } from 'drizzle-orm';

/** Commit ownership before doing network or storage work; competing workers skip locked rows. */
export async function claimMigration(id?: string) {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: repositoryMigrations.id })
      .from(repositoryMigrations)
      .where(
        and(
          eq(repositoryMigrations.status, 'pending'),
          id ? eq(repositoryMigrations.id, id) : undefined,
        ),
      )
      .orderBy(asc(repositoryMigrations.createdAt), asc(repositoryMigrations.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!pending) return undefined;

    const [claimed] = await tx
      .update(repositoryMigrations)
      .set({ status: 'cloning', progress: 10, startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(repositoryMigrations.id, pending.id), eq(repositoryMigrations.status, 'pending')),
      )
      .returning();
    return claimed;
  });
}
