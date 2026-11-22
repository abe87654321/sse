import { createHash } from 'crypto';
import { copyFile, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { ensureDir } from './fs-utils';
import type { ConfigExport } from './types';

const PUBLIC_CONFIGS = ['ai-config.json', 'ai-test-history.json'];

export async function exportConfigs(
  sseDir: string,
  outDir: string,
  options: { includeSecrets: boolean }
): Promise<ConfigExport[]> {
  await ensureDir(outDir);
  const results: ConfigExport[] = [];
  for (const name of PUBLIC_CONFIGS) {
    const source = join(sseDir, name);
    try {
      await stat(source);
    } catch {
      continue;
    }
    const target = join(outDir, name);
    await copyFile(source, target);
    results.push({
      name,
      sha256: createHash('sha256').update(await readFile(target)).digest('hex'),
      sensitive: false,
    });
  }
  if (options.includeSecrets) {
    const source = join(sseDir, '.env');
    try {
      const data = await readFile(source);
      await writeFile(join(outDir, 'env.local'), data);
      results.push({
        name: 'env.local',
        sha256: createHash('sha256').update(data).digest('hex'),
        sensitive: true,
      });
    } catch {
      /* .env missing is allowed */
    }
  }
  return results;
}
