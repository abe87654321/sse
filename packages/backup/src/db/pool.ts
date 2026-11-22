import { Client, Pool } from 'pg';
import type { BackupDatabaseConfig } from '../types';

export function createPool(config: BackupDatabaseConfig): Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 4,
  });
}

export function createClient(config: BackupDatabaseConfig, database = config.database): Client {
  return new Client({
    host: config.host,
    port: config.port,
    database,
    user: config.user,
    password: config.password,
  });
}
