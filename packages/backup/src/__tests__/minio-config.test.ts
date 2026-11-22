import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportObjects } from '../minio/export';
import { exportConfigs } from '../config-files';

function fakeStore(objects: Record<string, Buffer>) {
  return {
    listObjects: async (bucket: string) =>
      Object.keys(objects)
        .filter((key) => key.startsWith(`${bucket}/`))
        .map((key) => ({ key: key.slice(bucket.length + 1), size: objects[key].length })),
    getObject: async (bucket: string, key: string) => objects[`${bucket}/${key}`],
  };
}

test('exports objects preserving keys and hashes', async () => {
  const out = mkdtempSync(join(tmpdir(), 'sse-minio-'));
  const objects = await exportObjects(
    fakeStore({
      'avatars/u1_1.png': Buffer.from('png'),
      'invoices/invoices/r1/a.pdf': Buffer.from('pdf'),
    }) as any,
    ['avatars', 'invoices'],
    out
  );
  expect(objects).toHaveLength(2);
  expect(readFileSync(join(out, 'avatars', 'u1_1.png'), 'utf-8')).toBe('png');
  expect(readFileSync(join(out, 'invoices', 'invoices', 'r1', 'a.pdf'), 'utf-8')).toBe('pdf');
});

test('excludes .env by default and includes env.local only when requested', async () => {
  const sseDir = mkdtempSync(join(tmpdir(), 'sse-config-'));
  writeFileSync(join(sseDir, 'ai-config.json'), '{"a":1}');
  writeFileSync(join(sseDir, 'ai-test-history.json'), '[]');
  writeFileSync(join(sseDir, '.env'), 'SECRET=1');

  const out = mkdtempSync(join(tmpdir(), 'sse-config-out-'));
  const configs = await exportConfigs(sseDir, out, { includeSecrets: false });
  expect(configs.map((item) => item.name)).toEqual([
    'ai-config.json',
    'ai-test-history.json',
  ]);
  expect(() => readFileSync(join(out, 'env.local'))).toThrow();

  const out2 = mkdtempSync(join(tmpdir(), 'sse-config-out-'));
  const withSecrets = await exportConfigs(sseDir, out2, { includeSecrets: true });
  expect(withSecrets).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'env.local', sensitive: true })])
  );
  expect(readFileSync(join(out2, 'env.local'), 'utf-8')).toBe('SECRET=1');
});
