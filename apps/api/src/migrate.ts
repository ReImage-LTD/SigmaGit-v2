import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { resolve } from 'node:path';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
// A dedicated, single connection keeps the advisory lock on the migration session.
const client = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
try {
  await client`SELECT pg_advisory_lock(1936287597, 1)`;
  await migrate(drizzle(client), {
    migrationsFolder: resolve(import.meta.dir, '../../../packages/db/migrations'),
  });
  console.log('[Database] Migrations complete');
} finally {
  // Closing the connection also releases the lock on every failure path.
  await client.end({ timeout: 5 });
}
