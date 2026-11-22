import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { safeJoin } from '../fs-utils';
import type { BackupManifest } from '../types';
import type { ObjectStore } from './client';

export async function uploadObjects(
  target: ObjectStore,
  packageDir: string,
  manifest: BackupManifest,
  prefix: string
): Promise<void> {
  for (const object of manifest.objects ?? []) {
    const data = await readFile(safeJoin(join(packageDir, 'minio', object.bucket), object.key));
    await target.putObject(object.bucket, `${prefix}${object.key}`, data);
  }
}

export async function cleanupObjects(
  target: ObjectStore,
  manifest: BackupManifest,
  prefix: string
): Promise<void> {
  for (const bucket of new Set((manifest.objects ?? []).map((object) => object.bucket))) {
    await target.removePrefix(bucket, prefix);
  }
}

export async function verifyObjects(
  target: ObjectStore,
  manifest: BackupManifest,
  prefix: string
): Promise<{ failures: string[]; bucketCounts: Array<{ bucket: string; expected: number; actual: number }> }> {
  const failures: string[] = [];
  for (const object of manifest.objects ?? []) {
    try {
      const data = await target.getObject(object.bucket, `${prefix}${object.key}`);
      const sha = createHash('sha256').update(data).digest('hex');
      if (data.length !== object.size || sha !== object.sha256) {
        failures.push(`object mismatch: ${object.bucket}/${object.key}`);
      }
    } catch {
      failures.push(`object missing: ${object.bucket}/${object.key}`);
    }
  }

  const bucketCounts: Array<{ bucket: string; expected: number; actual: number }> = [];
  for (const bucket of new Set((manifest.objects ?? []).map((object) => object.bucket))) {
    const expected = (manifest.objects ?? []).filter((object) => object.bucket === bucket).length;
    const actual = (await target.listObjects(bucket, prefix)).length;
    bucketCounts.push({ bucket, expected, actual });
    if (actual !== expected) failures.push(`bucket ${bucket}: ${actual}/${expected}`);
  }
  return { failures, bucketCounts };
}
