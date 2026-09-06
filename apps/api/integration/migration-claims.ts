import { claimMigration } from '../src/lib/migration-claims';
import { db, repositoryMigrations } from '@sigmagit/db';
import { eq, inArray } from 'drizzle-orm';
import assert from 'node:assert/strict';

export async function checkMigrationClaims(userId: string) {
  const rows = await db
    .insert(repositoryMigrations)
    .values(
      Array.from({ length: 20 }, () => ({
        userId,
        source: 'url' as const,
        sourceUrl: 'https://example.invalid/repo.git',
      })),
    )
    .returning();
  const ids = rows.map((row) => row.id);
  try {
    const claims = (await Promise.all(Array.from({ length: 40 }, () => claimMigration()))).filter(
      (row) => row !== undefined,
    );
    assert.equal(claims.length, 20);
    assert.equal(new Set(claims.map((row) => row.id)).size, 20);
    assert(claims.every((row) => row.status === 'cloning' && row.startedAt && row.progress === 10));
    assert.equal(await claimMigration(ids[0]), undefined);
    await db
      .update(repositoryMigrations)
      .set({ status: 'failed' })
      .where(eq(repositoryMigrations.id, ids[0]));
    assert.equal(await claimMigration(ids[0]), undefined);
    console.log('PASS concurrent import claims are exclusive and terminal jobs cannot be claimed');
  } finally {
    await db.delete(repositoryMigrations).where(inArray(repositoryMigrations.id, ids));
  }
}
