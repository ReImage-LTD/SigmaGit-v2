import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

let client: ReturnType<typeof postgres> | undefined;
let lockDatabase: ReturnType<typeof drizzle> | undefined;
function getLockDatabase() {
  if (!lockDatabase) {
    client = postgres(process.env.DATABASE_URL!, { max: 8, idle_timeout: 20, connect_timeout: 10 });
    lockDatabase = drizzle(client);
  }
  return lockDatabase;
}

/** All ref writers must use the same cross-instance lock as receive-pack. */
export async function withRepositoryLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  // A separate bounded pool prevents lock holders from exhausting the connections
  // their protected handlers need to perform ordinary database queries.
  return getLockDatabase().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'git-push:' + id}, 0))`);
    return work();
  });
}

export async function closeRepositoryLocks() {
  await client?.end({ timeout: 5 });
  client = undefined; lockDatabase = undefined;
}
