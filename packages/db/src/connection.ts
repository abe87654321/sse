import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'sse',
  user: process.env.DB_USER || 'sse',
  password: process.env.DB_PASSWORD || 'sse_dev',
  max: 20,
  idleTimeoutMillis: 30000,
});

export { pool };
