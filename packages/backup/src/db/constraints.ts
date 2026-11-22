import { quoteIdent } from './schema';

export interface ForeignKeyDefinition {
  table: string;
  name: string;
  definition: string;
}

export async function dropForeignKeys(client: any): Promise<ForeignKeyDefinition[]> {
  const { rows } = await client.query(
    `SELECT child.relname AS table_name, c.conname AS constraint_name,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = child.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
      ORDER BY child.relname, c.conname`
  );
  const definitions = rows.map((row: any) => ({
    table: row.table_name,
    name: row.constraint_name,
    definition: row.definition,
  }));
  for (const fk of definitions) {
    await client.query(`ALTER TABLE ${quoteIdent(fk.table)} DROP CONSTRAINT ${quoteIdent(fk.name)}`);
  }
  return definitions;
}

export async function restoreForeignKeys(
  client: any,
  definitions: ForeignKeyDefinition[]
): Promise<void> {
  for (const fk of definitions) {
    await client.query(
      `ALTER TABLE ${quoteIdent(fk.table)}
         ADD CONSTRAINT ${quoteIdent(fk.name)} ${fk.definition}`
    );
  }
}
