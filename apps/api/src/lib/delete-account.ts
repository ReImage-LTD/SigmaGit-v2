import { db, users, repositories, issues, pullRequests } from '@sigmagit/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { queueRepositoryDeletion } from './repository-storage';

export function isOrganizationOwnershipError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const detail = error as { constraint_name?: string; constraint?: string; cause?: unknown };
  return detail.constraint_name === 'organization_requires_owner' ||
    detail.constraint === 'organization_requires_owner' ||
    (detail.cause !== error && isOrganizationOwnershipError(detail.cause));
}

export async function deleteAccount(userId: string): Promise<void> {
  await db.transaction(async tx => {
    // Lock the account before collecting personal assets so FK inserts cannot race deletion.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const personalRepos = await tx.select({ name: repositories.name, storageOwnerId: repositories.storageOwnerId })
      .from(repositories).where(and(eq(repositories.ownerId, userId), isNull(repositories.organizationId)));
    for (const repo of personalRepos) await queueRepositoryDeletion(tx, repo.storageOwnerId, repo.name);
    await tx.update(issues).set({ closedById: null }).where(eq(issues.closedById, userId));
    await tx.update(pullRequests).set({ mergedById: null, closedById: null })
      .where(or(eq(pullRequests.mergedById, userId), eq(pullRequests.closedById, userId)));
    // Database trigger reassigns org creator references and rejects last-owner deletion.
    // A rejection rolls back the queued cleanup as well.
    await tx.delete(users).where(eq(users.id, userId));
  });
}
