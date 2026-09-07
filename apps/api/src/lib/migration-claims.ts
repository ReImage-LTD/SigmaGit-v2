import { db, repositoryMigrations } from '@sigmagit/db';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';

export function migrationOwnership(id: string, startedAt: Date) {
  return and(eq(repositoryMigrations.id, id), eq(repositoryMigrations.startedAt, startedAt),
    inArray(repositoryMigrations.status, ['cloning', 'importing']));
}

export async function expireMigrationClaims() {
  await db.update(repositoryMigrations).set({ status: 'failed', errorMessage: 'Worker lease expired; retry the import', updatedAt: new Date() })
    .where(and(inArray(repositoryMigrations.status, ['cloning', 'importing']), lt(repositoryMigrations.updatedAt, new Date(Date.now() - 60_000))));
}

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
