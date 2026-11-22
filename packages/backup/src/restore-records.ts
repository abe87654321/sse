import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface RestoreRecord {
  id: string;
  backupId: string;
  targetDb: string;
  targetMinioPrefix: string;
  status: 'active' | 'deleted';
  createdAt: string;
  deletedAt?: string;
}

function restoresDir(backupDir: string): string {
  const dir = join(backupDir, 'restores');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function recordPath(backupDir: string, id: string): string {
  return join(restoresDir(backupDir), `${id}.json`);
}

export function writeRestoreRecord(
  backupDir: string,
  input: { backupId: string; targetDb: string; targetMinioPrefix: string }
): RestoreRecord {
  const createdAt = new Date().toISOString();
  const record: RestoreRecord = {
    id: `restore-${createdAt.replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random()
      .toString(16)
      .slice(2, 8)}`,
    backupId: input.backupId,
    targetDb: input.targetDb,
    targetMinioPrefix: input.targetMinioPrefix,
    status: 'active',
    createdAt,
  };
  writeFileSync(recordPath(backupDir, record.id), JSON.stringify(record, null, 2));
  return record;
}

export function listRestoreRecords(backupDir: string): RestoreRecord[] {
  const dir = join(backupDir, 'restores');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf-8')) as RestoreRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function markRestoreRecordDeleted(backupDir: string, id: string): void {
  const record = listRestoreRecords(backupDir).find((item) => item.id === id);
  if (!record) return;
  record.status = 'deleted';
  record.deletedAt = new Date().toISOString();
  writeFileSync(recordPath(backupDir, id), JSON.stringify(record, null, 2));
}
