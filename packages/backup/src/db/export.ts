import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { join } from 'path';
import Cursor from 'pg-cursor';
import { ensureDir } from '../fs-utils';
import { readDatabaseSchema, quoteIdent } from './schema';
import type { DatabaseSchema, TableExport } from '../types';

export async function exportDatabase(
  client: any,
  outDir: string
): Promise<{ schema: DatabaseSchema; tables: TableExport[] }> {
  await ensureDir(outDir);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const schema = await readDatabaseSchema(client);
    const tables: TableExport[] = [];
    for (const table of schema.tables) {
      const ident = quoteIdent(table.name);
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::text AS c FROM ${ident}`
      );
      const expected = Number(countRows[0].c);
      const file = join(outDir, `${table.name}.jsonl`);
      const out = createWriteStream(file);
      const hash = createHash('sha256');
      const cursor = client.cursorFactory
        ? client.cursorFactory(`SELECT row_to_json(t)::text AS line FROM ${ident} t ORDER BY ctid`)
        : client.query(
            new Cursor(`SELECT row_to_json(t)::text AS line FROM ${ident} t ORDER BY ctid`, [])
          );

      let written = 0;
      try {
        while (true) {
          const batch = await cursor.read(500);
          if (batch.length === 0) break;
          const text = batch.map((row: any) => row.line).join('\n') + '\n';
          hash.update(text);
          if (!out.write(text)) await new Promise<void>((resolve) => out.once('drain', resolve));
          written += batch.length;
        }
      } finally {
        await cursor.close();
        await new Promise<void>((resolve, reject) =>
          out.end((error?: Error | null) => (error ? reject(error) : resolve()))
        );
      }

      if (written !== expected) throw new Error(`ROW_COUNT_MISMATCH ${table.name}`);
      tables.push({
        name: table.name,
        rows: written,
        columns: table.columns.map((column) => column.name),
        sha256: hash.digest('hex'),
      });
    }
    await client.query('COMMIT');
    return { schema, tables };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
