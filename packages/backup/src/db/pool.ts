import { Client, Pool } from 'pg';
import type { BackupDatabaseConfig } from '../types';

export function createPool(config: BackupDatabaseConfig): Pool {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 4,
  });
  pool.on('error', (error) => {
    console.error('[backup] idle database client error', error);
  });
  return pool;
}

export function createClient(config: BackupDatabaseConfig, database = config.database): Client {
  const client = new Client({
    host: config.host,
    port: config.port,
    database,
    user: config.user,
    password: config.password,
  });
  client.on('error', (error) => {
    console.error('[backup] database client error', error);
  });
  return client;
}
