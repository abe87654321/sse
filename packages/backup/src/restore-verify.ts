import { createHash } from 'crypto';
import { quoteIdent } from './db/schema';
import { verifyObjects } from './minio/import';
import type { ObjectStore } from './minio/client';
import type { BackupManifest } from './types';

export interface RestoreVerifyResult {
  ok: boolean;
  failures: string[];
  tables: Array<{ name: string; expected: number; actual: number; ok: boolean }>;
  objects: Array<{ bucket: string; expected: number; actual: number }>;
  links: { expected: number; matched: number };
}

export async function verifyRestore(input: {
  pool: any;
  objectStore: ObjectStore;
  prefix: string;
  manifest: BackupManifest;
}): Promise<RestoreVerifyResult> {
  const failures: string[] = [];
  const tables: RestoreVerifyResult['tables'] = [];

  for (const table of input.manifest.tables ?? []) {
    const { rows } = await input.pool.query(
      `SELECT COUNT(*)::text AS c FROM ${quoteIdent(table.name)}`
    );
    const actual = Number(rows[0].c);
    const ok = actual === table.rows;
    if (!ok) failures.push(`table ${table.name}: ${actual}/${table.rows}`);
    tables.push({ name: table.name, expected: table.rows, actual, ok });
  }

  const objectResult = await verifyObjects(
    input.objectStore,
    input.manifest,
    input.prefix
  );
  failures.push(...objectResult.failures);

  let expectedLinks = 0;
  let matchedLinks = 0;
  const { rows: linkRows } = await input.pool.query(
    `SELECT 'invoices' AS bucket, storage_key AS key FROM invoices
     UNION ALL
     SELECT 'payment-receipts' AS bucket, storage_key AS key FROM payment_receipts
     UNION ALL
     SELECT 'avatars' AS bucket, avatar_url AS key FROM users WHERE avatar_url IS NOT NULL`
  );
  for (const link of linkRows) {
    expectedLinks += 1;
    try {
      const data = await input.objectStore.getObject(link.bucket, `${input.prefix}${link.key}`);
      if (data.length >= 0) matchedLinks += 1;
    } catch {
      failures.push(`link missing: ${link.bucket}/${link.key}`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    tables,
    objects: objectResult.bucketCounts,
    links: { expected: expectedLinks, matched: matchedLinks },
  };
}

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
