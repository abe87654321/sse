import {
  LocalBackupStore,
  MinioBackupStore,
  acquireBackupLock,
  cleanupDrill,
  createBackup,
  createMinioClient,
  defaultCleanupDeps,
  defaultCreateBackupDeps,
  defaultRestoreDeps,
  listRestoreRecords,
  loadBackupConfig,
  resolveBackupPackage,
  restoreBackup,
  verifyPackage,
} from '@sse/backup';
import { BackupJobService } from './backup-jobs';

export interface BackupService extends BackupJobService {
  listBackups(location: 'local' | 'minio'): Promise<any[]>;
  download(id: string, res: any): Promise<void>;
  upload(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

let instance: BackupService | null = null;

export function getBackupService(): BackupService {
  if (!instance) instance = buildBackupService();
  return instance;
}

export function __resetBackupServiceForTests(): void {
  instance = null;
}

function buildBackupService(): BackupService {
  const config = loadBackupConfig();
  const local = new LocalBackupStore(config.backupDir);
  const minio = new MinioBackupStore(
    createMinioClient(config.minio),
    config.minioBackupBucket,
    config.minioBackupPrefix
  );

  const jobs = new BackupJobService({
    backupDir: config.backupDir,
    acquireLock: () => acquireBackupLock(config.db),
    createBackup: (options) =>
      createBackup(options, { config, ...defaultCreateBackupDeps }),
    verifyBackup: async (id) => {
      const pkg = await resolveBackupPackage({
        idOrPath: id,
        backupDir: config.backupDir,
        minio,
      });
      return verifyPackage(pkg);
    },
    restoreBackup: (options) => restoreBackup(options, defaultRestoreDeps(config)),
    cleanupDrill: (options) => cleanupDrill(options, defaultCleanupDeps(config)),
    resolvePackage: (id) =>
      resolveBackupPackage({ idOrPath: id, backupDir: config.backupDir, minio }),
    listRestoreRecords,
  });

  return Object.assign(jobs, {
    async listBackups(location: 'local' | 'minio'): Promise<any[]> {
      const localItems = await local.list();
      let minioIds = new Set<string>();
      try {
        minioIds = new Set(await minio.list());
      } catch (error) {
        console.error('[backup] failed to list MinIO backups', error);
      }
      if (location === 'minio') {
        return [...minioIds].map((id) => ({ id, manifest: null, locations: ['minio'] }));
      }
      return localItems
        .map((item) => ({
          ...item,
          locations: minioIds.has(item.id) ? ['local', 'minio'] : ['local'],
        }))
        .sort((a, b) => b.id.localeCompare(a.id));
    },
    async download(id: string, res: any): Promise<void> {
      const items = await local.list();
      const localItem = items.find((item) => item.id === id);
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${id}.tar.gz"`);
      if (localItem) {
        const { createReadStream } = await import('fs');
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(localItem.archivePath);
          stream.on('error', reject);
          res.on('finish', resolve);
          stream.pipe(res);
        });
        return;
      }
      const stream = await minio.createReadStream(id);
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject);
        res.on('finish', resolve);
        stream.pipe(res);
      });
    },
    async upload(id: string): Promise<void> {
      const item = (await local.list()).find((entry) => entry.id === id);
      if (!item) throw new Error('BACKUP_NOT_FOUND');
      await minio.upload(id, item.archivePath);
    },
    async remove(id: string): Promise<void> {
      await local.delete(id);
      await minio.delete(id);
    },
  });
}
