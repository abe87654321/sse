import { createHash } from 'crypto';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { ensureDir, safeJoin } from '../fs-utils';
import type { ObjectExport } from '../types';
import type { ObjectSource } from './client';

export async function exportObjects(
  store: ObjectSource,
  buckets: string[],
  outDir: string
): Promise<ObjectExport[]> {
  await ensureDir(outDir);
  const objects: ObjectExport[] = [];
  for (const bucket of buckets) {
    for (const item of await store.listObjects(bucket)) {
      const data = await store.getObject(bucket, item.key);
      if (data.length !== item.size) throw new Error(`OBJECT_SIZE_MISMATCH ${bucket}/${item.key}`);
      const target = safeJoin(join(outDir, bucket), item.key);
      await ensureDir(dirname(target));
      await writeFile(target, data);
      objects.push({
        bucket,
        key: item.key,
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
    }
  }
  return objects;
}
