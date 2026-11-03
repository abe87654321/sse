import type { PoolClient } from 'pg';

export type Queryable = {
  query: (text: string, values?: any[]) => Promise<{ rows: any[] }>;
};

export type Connectable = {
  connect: () => Promise<PoolClient>;
};

export async function withTransaction<T>(
  pool: Connectable,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure; the connection is released below.
    }
    throw error;
  } finally {
    client.release();
  }
}
