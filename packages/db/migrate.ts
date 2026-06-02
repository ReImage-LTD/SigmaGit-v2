import { config } from './src/config';
import { createDatabase } from './src/index';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function runMigrations() {
  console.log('[Migrations] Starting database migrations...');

  const migrationFiles = [
    '001_add_discord_links.sql',
    '002_optimize_search_and_indexes.sql',
  ];

  const db = createDatabase(config.databaseUrl);

  for (const file of migrationFiles) {
    const migrationPath = join(process.cwd(), 'packages/db/migrations', file);

    try {
      console.log(`[Migrations] Running migration: ${file}`);
      const migrationSql = readFileSync(migrationPath, 'utf8');

      await db.execute(migrationSql);
      console.log(`[Migrations] ✓ Completed migration: ${file}`);
    } catch (error) {
      console.error(`[Migrations] ✗ Failed migration: ${file}`, error);
      throw error;
    }
  }

  console.log('[Migrations] All migrations completed successfully!');
}

runMigrations().catch((error) => {
  console.error('[Migrations] Fatal error:', error);
  process.exit(1);
});
