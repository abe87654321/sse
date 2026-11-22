import { existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureDir } from '../fs-utils';
import { extractArchive } from '../archive';
import type { MinioBackupStore } from './minio-store';

export async function resolveBackupPackage(options: {
  idOrPath: string;
  backupDir: string;
  minio?: MinioBackupStore;
}): Promise<string> {
  const candidate = options.idOrPath;
  if (existsSync(join(candidate, 'manifest.json'))) return candidate;
  if (existsSync(join(candidate, 'package', 'manifest.json'))) {
    return join(candidate, 'package');
  }
  const local = join(options.backupDir, candidate, 'package');
  if (existsSync(join(local, 'manifest.json'))) return local;
  if (!options.minio) throw new Error('BACKUP_NOT_FOUND');

  const temp = mkdtempSync(join(tmpdir(), `sse-restore-${candidate}-`));
  const archive = join(temp, `${candidate}.tar.gz`);
  await options.minio.download(candidate, archive);
  const extracted = join(temp, 'package');
  await ensureDir(extracted);
  await extractArchive(archive, extracted);
  return extracted;
}
