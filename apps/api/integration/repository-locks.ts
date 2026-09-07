import assert from 'node:assert/strict';
import { db } from '@sigmagit/db';
import { sql } from 'drizzle-orm';
import { withRepositoryLock } from '../src/lib/repository-lock';

export async function checkRepositoryLocks() {
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let secondEntered = false;
  const first = withRepositoryLock('lock-test', async () => { held.resolve(); await release.promise; });
  await held.promise;
  const second = withRepositoryLock('lock-test', async () => { secondEntered = true; });
  try { await Bun.sleep(30); assert.equal(secondEntered, false); }
  finally { release.resolve(); await Promise.all([first, second]); }
  assert.equal(secondEntered, true);
  await Promise.all(Array.from({ length: 60 }, (_, i) => withRepositoryLock(`pool-test-${i}`, async () => { await db.execute(sql`SELECT 1`); })));
  console.log('PASS shared repository locks serialize writers without starving their database queries');
}
