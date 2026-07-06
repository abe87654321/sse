import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './connection';

async function migrate() {
  const client = await pool.connect();
  try {
    const sql = readFileSync(join(__dirname, '..', 'src', 'migrations', '001_initial.sql'), 'utf-8');
    await client.query(sql);
    console.log('Migration 001 applied successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
