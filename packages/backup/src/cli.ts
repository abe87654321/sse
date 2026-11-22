import { Command } from 'commander';
import { loadBackupConfig } from './config';
import {
  createBackup,
  defaultCreateBackupDeps,
  type CreateBackupDeps,
} from './backup';
import { LocalBackupStore } from './storage/local-store';
import { MinioBackupStore } from './storage/minio-store';
import { resolveBackupPackage } from './storage/resolve';
import { createMinioClient } from './minio/client';
import { verifyPackage } from './verify';
import { defaultRestoreDeps, restoreBackup } from './restore';
import { cleanupDrill, defaultCleanupDeps } from './drill-cleanup';
import { listRestoreRecords } from './restore-records';

export interface CliOverrides {
  createDeps?: CreateBackupDeps;
  logger?: (line: string) => void;
}

export async function runCli(argv: string[], overrides: CliOverrides = {}): Promise<number> {
  const config = loadBackupConfig();
  const logger = overrides.logger ?? ((line: string) => console.log(line));
  const program = new Command();
  program.name('sse-backup').exitOverride();

  const minioStore = (backupDir: string) =>
    new MinioBackupStore(
      createMinioClient(config.minio),
      config.minioBackupBucket,
      config.minioBackupPrefix
    );

  program
    .command('create')
    .option('--out <dir>', '本地备份根目录')
    .option('--include-secrets', '包含 .env', false)
    .option('--upload', '上传到 MinIO', false)
    .action(async (options) => {
      const result = await createBackup(
        {
          backupDir: options.out || config.backupDir,
          includeSecrets: Boolean(options.includeSecrets),
          upload: Boolean(options.upload),
        },
        overrides.createDeps ?? { config, ...defaultCreateBackupDeps }
      );
      logger(`backup created: ${result.id}`);
      logger(`archive: ${result.archivePath}`);
    });

  program
    .command('list')
    .option('--out <dir>', '本地备份根目录')
    .action(async (options) => {
      const store = new LocalBackupStore(options.out || config.backupDir);
      for (const item of await store.list()) logger(item.id);
    });

  program
    .command('verify')
    .requiredOption('--from <idOrPath>')
    .option('--out <dir>', '本地备份根目录')
    .action(async (options) => {
      const backupDir = options.out || config.backupDir;
      const pkg = await resolveBackupPackage({
        idOrPath: options.from,
        backupDir,
        minio: minioStore(backupDir),
      });
      const result = await verifyPackage(pkg);
      logger(result.ok ? 'verify ok' : `verify failed: ${result.failures.join(', ')}`);
      if (!result.ok) process.exitCode = 3;
    });

  program
    .command('restore')
    .requiredOption('--from <idOrPath>')
    .requiredOption('--target-db <name>')
    .option('--target-minio-prefix <prefix>', '演练对象前缀')
    .option('--dry-run', '只做预检', false)
    .option('--out <dir>', '本地备份根目录')
    .action(async (options) => {
      const backupDir = options.out || config.backupDir;
      const pkg = await resolveBackupPackage({
        idOrPath: options.from,
        backupDir,
        minio: minioStore(backupDir),
      });
      const targetMinioPrefix =
        options.targetMinioPrefix || `drills/${options.targetDb}/`;
      const result = await restoreBackup(
        {
          from: pkg,
          targetDb: options.targetDb,
          targetMinioPrefix,
          dryRun: Boolean(options.dryRun),
        },
        defaultRestoreDeps({ ...config, backupDir })
      );
      logger(`restore ok: ${result.ok}`);
      if ('restoreId' in result) logger(`restore id: ${result.restoreId}`);
    });

  program
    .command('drills')
    .option('--out <dir>', '本地备份根目录')
    .action(async (options) => {
      for (const record of listRestoreRecords(options.out || config.backupDir)) {
        logger(`${record.id} ${record.targetDb} ${record.status}`);
      }
    });

  program
    .command('drill:clean')
    .requiredOption('--target-db <name>')
    .option('--target-minio-prefix <prefix>', '演练对象前缀')
    .option('--confirm <text>', '必须为 CLEANUP <targetDb>')
    .option('--restore-id <id>')
    .option('--out <dir>', '本地备份根目录')
    .action(async (options) => {
      const backupDir = options.out || config.backupDir;
      const result = await cleanupDrill(
        {
          targetDb: options.targetDb,
          targetMinioPrefix:
            options.targetMinioPrefix || `drills/${options.targetDb}/`,
          confirm: options.confirm || '',
          restoreId: options.restoreId,
        },
        defaultCleanupDeps({ ...config, backupDir })
      );
      logger(`drill cleaned: ${result.targetDb}`);
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error: any) {
    if (
      error?.code === 'commander.helpDisplayed' ||
      error?.code === 'commander.version' ||
      error?.exitCode === 0
    ) {
      return 0;
    }
    logger(error instanceof Error ? error.message : String(error));
    return typeof error?.exitCode === 'number' && error.exitCode > 0 ? error.exitCode : 1;
  }
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
