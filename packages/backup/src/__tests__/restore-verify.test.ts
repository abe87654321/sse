import { createHash } from 'crypto';
import { verifyRestore } from '../restore-verify';

const png = Buffer.from('png');
const manifest = {
  tables: [{ name: 'users', rows: 1 }],
  objects: [{
    bucket: 'avatars',
    key: 'u1.png',
    size: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
  }],
} as any;

test('verifies table counts, object checksums and DB/object links', async () => {
  const pool = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ c: '1' }] };
      if (sql.includes('UNION ALL')) return { rows: [{ bucket: 'avatars', key: 'u1.png' }] };
      return { rows: [] };
    }),
  };
  const objectStore = {
    listObjects: jest.fn(async () => [{ key: 'drills/b1/u1.png', size: png.length }]),
    getObject: jest.fn(async () => png),
  };

  const result = await verifyRestore({
    pool: pool as any,
    objectStore: objectStore as any,
    prefix: 'drills/b1/',
    manifest,
  });

  expect(result.ok).toBe(true);
  expect(result.links).toEqual({ expected: 1, matched: 1 });
  expect(result.tables[0]).toMatchObject({ name: 'users', expected: 1, actual: 1, ok: true });
});

test('fails when a linked object is missing', async () => {
  const pool = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ c: '1' }] };
      if (sql.includes('UNION ALL')) return { rows: [{ bucket: 'avatars', key: 'u1.png' }] };
      return { rows: [] };
    }),
  };
  const objectStore = {
    listObjects: jest.fn(async () => []),
    getObject: jest.fn(async () => {
      throw new Error('missing');
    }),
  };

  const result = await verifyRestore({
    pool: pool as any,
    objectStore: objectStore as any,
    prefix: 'drills/b1/',
    manifest,
  });
  expect(result.ok).toBe(false);
  expect(result.failures.join('\n')).toContain('object missing');
  expect(result.failures.join('\n')).toContain('link missing');
});
