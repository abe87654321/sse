import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  loadBackupConfig,
  sha256File,
  safeJoin,
  writeChecksums,
  verifyChecksums,
  createArchive,
  extractArchive,
} from '../index';

test('loadBackupConfig applies defaults', () => {
  const config = loadBackupConfig({
    env: { DB_HOST: 'db', DB_PORT: '5433', DB_NAME: 'sse', DB_USER: 'sse', BACKUP_DIR: 'C:/backups' },
  });
  expect(config.db.host).toBe('db');
  expect(config.backupDir).toBe(resolve('C:/backups'));
  expect(config.minio.buckets).toEqual(['invoices', 'payment-receipts', 'avatars']);
});

test('sha256File hashes file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-backup-'));
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'hello');
  expect(sha256File(file)).toBe(
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
  );
});

test('safeJoin rejects traversal and checksums detect tampering', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-backup-'));
  expect(() => safeJoin(dir, '../evil.txt')).toThrow('PATH_TRAVERSAL');
  mkdirSync(join(dir, 'db'));
  writeFileSync(join(dir, 'db', 'users.jsonl'), '{"id":1}\n');
  writeChecksums(dir);
  expect(verifyChecksums(dir).ok).toBe(true);
  writeFileSync(join(dir, 'db', 'users.jsonl'), '{"id":2}\n');
  expect(verifyChecksums(dir).ok).toBe(false);
});

test('archive round-trips the package directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-backup-'));
  const pkg = join(dir, 'package');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'manifest.json'), '{}');
  const archive = join(dir, 'pkg.tar.gz');
  await createArchive(pkg, archive);
  const out = join(dir, 'extracted');
  mkdirSync(out);
  await extractArchive(archive, out);
  expect(readFileSync(join(out, 'manifest.json'), 'utf-8')).toBe('{}');
});
