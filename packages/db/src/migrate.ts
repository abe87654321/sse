import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { PoolClient } from 'pg';
import { pool } from './connection';
import {
  migrationVersion,
  planPendingMigrations,
  planRollback,
} from './migration-planner';

const ADVISORY_LOCK_KEY = 727001;

interface Queryable {
  query(sql: string, params?: any[]): Promise<any>;
}

function migrationsDir(): string {
  const candidates = [
    join(__dirname, 'migrations'),
    join(__dirname, '..', 'src', 'migrations'),
  ];
  for (const dir of candidates) {
    try {
      readdirSync(dir);
      return dir;
    } catch {
      /* try next */
    }
  }
  throw new Error('MIGRATIONS_DIR_NOT_FOUND');
}

function listMigrationFiles(): string[] {
  return readdirSync(migrationsDir()).filter(file => file.endsWith('.sql'));
}

async function ensureMigrationsTable(db: Queryable): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
}

async function getAppliedVersions(db: Queryable): Promise<string[]> {
  const { rows } = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  return rows.map((row: any) => row.version);
}

export async function applyMigrations(
  db: Queryable,
  filenames?: string[]
): Promise<string[]> {
  await ensureMigrationsTable(db);

  const files = filenames ?? listMigrationFiles();
  const pending = planPendingMigrations(files, await getAppliedVersions(db));
  const applied: string[] = [];

  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir(), file), 'utf-8');
    try {
      await db.query('BEGIN');
      await db.query(sql);
      const version = migrationVersion(file);
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await db.query('COMMIT');
      applied.push(version);
    } catch (error) {
      await db.query('ROLLBACK');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed: ${message}`);
    }
  }

  return applied;
}

async function migrateUp(client: PoolClient): Promise<void> {
  const applied = await applyMigrations(client);
  if (applied.length === 0) {
    console.log('Database is up to date');
    return;
  }
  for (const version of applied) console.log(`Applied ${version}`);
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

  const sql = readFileSync(join(migrationsDir(), plan.downFile), 'utf-8');
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

if (require.main === module) {
  run().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
