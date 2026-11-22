import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { verifyPackage } from '../verify';
import { writeChecksums } from '../manifest';
import { sha256File } from '../fs-utils';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sse-verify-'));
  mkdirSync(join(root, 'db'), { recursive: true });
  mkdirSync(join(root, 'meta'), { recursive: true });
  writeFileSync(join(root, 'db', 'users.jsonl'), '{"id":1}\n');
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    formatVersion: 1,
    id: 'b1',
    tables: [{ name: 'users', rows: 1, sha256: sha256File(join(root, 'db', 'users.jsonl')) }],
    objects: [],
    configs: [],
  }));
  writeChecksums(root);
  return root;
}

test('detects tampering and row count mismatch', async () => {
  const root = fixture();
  expect((await verifyPackage(root)).ok).toBe(true);
  writeFileSync(join(root, 'db', 'users.jsonl'), '{"id":2}\n');
  const broken = await verifyPackage(root);
  expect(broken.ok).toBe(false);
  expect(broken.failures.join('\n')).toContain('checksum');
});
