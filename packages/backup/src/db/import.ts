import { readFileSync } from 'fs';
import { join } from 'path';
import { quoteIdent } from './schema';
import type { DatabaseSchema } from '../types';

export interface ImportTablePlan {
  name: string;
  columns: string[];
  skippedColumns: string[];
}

export function planImport(source: DatabaseSchema, target: DatabaseSchema): {
  tables: ImportTablePlan[];
  warnings: string[];
} {
  const targetByName = new Map(target.tables.map((table) => [table.name, table]));
  const tables: ImportTablePlan[] = [];
  const warnings: string[] = [];
  for (const sourceTable of source.tables) {
    const targetTable = targetByName.get(sourceTable.name);
    if (!targetTable) throw new Error(`MISSING_TARGET_TABLE ${sourceTable.name}`);
    const sourceNames = sourceTable.columns.map((column) => column.name);
    const targetNames = new Set(targetTable.columns.map((column) => column.name));
    const columns = sourceNames.filter((name) => targetNames.has(name));
    const skippedColumns = sourceNames.filter((name) => !targetNames.has(name));
    for (const targetColumn of targetTable.columns) {
      if (sourceNames.includes(targetColumn.name)) continue;
      if (!targetColumn.nullable && targetColumn.default === null) {
        throw new Error(`MISSING_REQUIRED_COLUMN ${sourceTable.name}.${targetColumn.name}`);
      }
    }
    if (skippedColumns.length > 0) {
      warnings.push(`${sourceTable.name} dropped: ${skippedColumns.join(',')}`);
    }
    tables.push({ name: sourceTable.name, columns, skippedColumns });
  }
  return { tables, warnings };
}

export async function importPackageTables(
  client: any,
  dbDir: string,
  tables: ImportTablePlan[],
  batchSize = 500
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    let raw: string;
    try {
      raw = readFileSync(join(dbDir, `${table.name}.jsonl`), 'utf-8');
    } catch {
      counts[table.name] = 0;
      continue;
    }
    const lines = raw.split('\n').filter(Boolean);
    counts[table.name] = lines.length;
    for (let offset = 0; offset < lines.length; offset += batchSize) {
      const json = `[${lines.slice(offset, offset + batchSize).join(',')}]`;
      const select = table.columns.map((column) => `(r).${quoteIdent(column)}`).join(', ');
      await client.query(
        `INSERT INTO ${quoteIdent(table.name)} (${table.columns.map(quoteIdent).join(', ')})
         SELECT ${select}
           FROM json_populate_recordset(NULL::${quoteIdent(table.name)}, $1::json) AS r`,
        [json]
      );
    }
  }
  return counts;
}
