import { readFileSync } from 'fs';
import { join } from 'path';
import { readManifest, verifyChecksums } from './manifest';
import { sha256File } from './fs-utils';

export interface VerifyResult {
  ok: boolean;
  checksums: { ok: boolean; checked: number; failures: string[] };
  tables: Array<{ name: string; rows: number; actualRows: number; ok: boolean }>;
  failures: string[];
}

export async function verifyPackage(packageDir: string): Promise<VerifyResult> {
  const failures: string[] = [];
  const checksums = verifyChecksums(packageDir);
  if (!checksums.ok) failures.push(`checksum: ${checksums.failures.join(', ')}`);

  const manifest = readManifest(packageDir);
  const tables = [];
  for (const table of manifest.tables ?? []) {
    const file = join(packageDir, 'db', `${table.name}.jsonl`);
    let actualRows = 0;
    let actualHash = '';
    try {
      actualRows = readFileSync(file, 'utf-8').split('\n').filter(Boolean).length;
      actualHash = sha256File(file);
    } catch {
      failures.push(`missing table file: ${table.name}`);
    }
    const ok = actualRows === table.rows && (!table.sha256 || actualHash === table.sha256);
    if (!ok) failures.push(`table ${table.name}: ${actualRows}/${table.rows}`);
    tables.push({ name: table.name, rows: table.rows, actualRows, ok });
  }
  return { ok: failures.length === 0, checksums, tables, failures };
}
