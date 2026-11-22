import type { DatabaseSchema, SchemaTable } from '../types';

const EXCLUDED = new Set(['schema_migrations']);

export async function readDatabaseSchema(client: any): Promise<DatabaseSchema> {
  const { rows: tableRows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  const tableNames = tableRows
    .map((row: any) => row.table_name)
    .filter((name: string) => !EXCLUDED.has(name));

  const { rows: columnRows } = await client.query(
    `SELECT table_name, column_name, ordinal_position, data_type, udt_name,
            is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`
  );
  const byTable = new Map<string, SchemaTable>();
  for (const name of tableNames) byTable.set(name, { name, columns: [] });
  for (const row of columnRows) {
    const table = byTable.get(row.table_name);
    if (!table) continue;
    table.columns.push({
      name: row.column_name,
      ordinal: Number(row.ordinal_position),
      dataType: row.data_type,
      udtName: row.udt_name,
      nullable: row.is_nullable === 'YES',
      default: row.column_default,
    });
  }

  const { rows: versionRows } = await client.query(
    `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`
  );
  const { rows: serverRows } = await client.query('SHOW server_version');
  return {
    schemaVersion: versionRows[0]?.version ?? 'unknown',
    serverVersion: String(serverRows[0]?.server_version ?? 'unknown'),
    tables: [...byTable.values()],
  };
}

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('INVALID_IDENTIFIER');
  return `"${name.replace(/"/g, '""')}"`;
}
