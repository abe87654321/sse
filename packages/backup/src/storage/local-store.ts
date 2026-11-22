import { existsSync } from 'fs';
import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import { readManifest } from '../manifest';

export interface BackupListItem {
  id: string;
  manifest: any;
  archivePath: string;
  location: 'local';
}

export class LocalBackupStore {
  constructor(private readonly root: string) {}

  async list(): Promise<BackupListItem[]> {
    if (!existsSync(this.root)) return [];
    const entries = await readdir(this.root, { withFileTypes: true });
    const items: BackupListItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkg = join(this.root, entry.name, 'package');
      if (!existsSync(join(pkg, 'manifest.json'))) continue;
      items.push({
        id: entry.name,
        manifest: readManifest(pkg),
        archivePath: join(this.root, entry.name, `${entry.name}.tar.gz`),
        location: 'local',
      });
    }
    return items.sort((a, b) => b.id.localeCompare(a.id));
  }

  async delete(id: string): Promise<void> {
    await rm(join(this.root, id), { recursive: true, force: true });
  }

  async cleanup(keep: number): Promise<string[]> {
    const stale = (await this.list()).slice(Math.max(keep, 0));
    for (const item of stale) await this.delete(item.id);
    return stale.map((item) => item.id);
  }
}
