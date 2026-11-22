import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalBackupStore } from '../storage/local-store';
import { resolveBackupPackage } from '../storage/resolve';

function seed(root: string, id: string): void {
  mkdirSync(join(root, id, 'package'), { recursive: true });
  writeFileSync(join(root, id, 'package', 'manifest.json'), JSON.stringify({ id }));
  writeFileSync(join(root, id, `${id}.tar.gz`), 'archive');
}

test('lists newest first and cleans up old backups', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-store-'));
  seed(root, '20261121-000000-a');
  seed(root, '20261122-000000-b');
  seed(root, '20261123-000000-c');
  const store = new LocalBackupStore(root);
  expect((await store.list()).map((item) => item.id)).toEqual([
    '20261123-000000-c',
    '20261122-000000-b',
    '20261121-000000-a',
  ]);
  expect(await store.cleanup(2)).toEqual(['20261121-000000-a']);
  expect(existsSync(join(root, '20261121-000000-a'))).toBe(false);
});

test('resolves a local id or package path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-store-'));
  seed(root, 'b1');
  const pkg = await resolveBackupPackage({ idOrPath: 'b1', backupDir: root });
  expect(pkg).toBe(join(root, 'b1', 'package'));
  expect(existsSync(join(pkg, 'manifest.json'))).toBe(true);
});
