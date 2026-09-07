import { db } from '@sigmagit/db';
import { sql } from 'drizzle-orm';

/** All ref writers must use the same cross-instance lock as receive-pack. */
export async function withRepositoryLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'git-push:' + id}, 0))`);
    return work();
  });
}
