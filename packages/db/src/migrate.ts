import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { PoolClient } from 'pg';
import { pool } from './connection';
import {
  migrationVersion,
  planPendingMigrations,
  planRollback,
} from './migration-planner';

const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'migrations');
const ADVISORY_LOCK_KEY = 727001;

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.sql'));
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
}

async function getAppliedVersions(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  return rows.map(row => row.version);
}

async function migrateUp(client: PoolClient): Promise<void> {
  await ensureMigrationsTable(client);

  const files = listMigrationFiles();
  const pending = planPendingMigrations(files, await getAppliedVersions(client));

  if (pending.length === 0) {
    console.log('Database is up to date');
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [
        migrationVersion(file),
      ]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed: ${message}`);
    }
  }
}

async function migrateDown(client: PoolClient): Promise<void> {
  await ensureMigrationsTable(client);

  const files = listMigrationFiles();
  const plan = planRollback(await getAppliedVersions(client), files);

  if (!plan) {
    console.log('No migrations to roll back');
    return;
  }

  if (!plan.downFile) {
    throw new Error(
      `No down migration found for ${plan.version} (expected ${plan.version}.down.sql)`
    );
  }

  const sql = readFileSync(join(MIGRATIONS_DIR, plan.downFile), 'utf-8');
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE version = $1', [plan.version]);
    await client.query('COMMIT');
    console.log(`Rolled back ${plan.version}`);
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Rollback ${plan.version} failed: ${message}`);
  }
}

async function run(): Promise<void> {
  const command = process.argv[2] || 'up';
  const handler =
    command === 'up' ? migrateUp : command === 'down' ? migrateDown : null;

  if (!handler) {
    throw new Error(`Unknown migration command: ${command}. Use "up" or "down".`);
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await handler(client);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      // Ignore unlock failures; the connection is about to close.
    }
    client.release();
    await pool.end();
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
