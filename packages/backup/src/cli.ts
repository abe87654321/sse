import { Command } from 'commander';
import { loadBackupConfig } from './config';
import {
  createBackup,
  defaultCreateBackupDeps,
  type CreateBackupDeps,
} from './backup';
import { LocalBackupStore } from './storage/local-store';

export interface CliOverrides {
  createDeps?: CreateBackupDeps;
  logger?: (line: string) => void;
}

export async function runCli(argv: string[], overrides: CliOverrides = {}): Promise<number> {
  const config = loadBackupConfig();
  const logger = overrides.logger ?? ((line: string) => console.log(line));
  const program = new Command();
  program.name('sse-backup').exitOverride();

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

  try {
    await program.parseAsync(argv, { from: 'user' });
    return process.exitCode ?? 0;
  } catch (error) {
    logger(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
