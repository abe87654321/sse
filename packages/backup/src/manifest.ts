import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sha256File, walkFiles, relativePosix } from './fs-utils';

const CHECKSUM_FILE = 'meta/checksums.sha256';

export function writeChecksums(packageDir: string): void {
  const files = walkFiles(packageDir).filter(
    (file) => relativePosix(packageDir, file) !== CHECKSUM_FILE
  );
  const lines = files.map(
    (file) => `${sha256File(file)}  ${relativePosix(packageDir, file)}`
  );
  mkdirSync(join(packageDir, 'meta'), { recursive: true });
  writeFileSync(join(packageDir, CHECKSUM_FILE), lines.join('\n') + '\n');
}

export function verifyChecksums(packageDir: string): {
  ok: boolean;
  checked: number;
  failures: string[];
} {
  const raw = readFileSync(join(packageDir, CHECKSUM_FILE), 'utf-8');
  const failures: string[] = [];
  let checked = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) {
      failures.push(`malformed: ${line}`);
      continue;
    }
    checked += 1;
    const [, expected, rel] = match;
    try {
      if (sha256File(join(packageDir, rel)) !== expected) failures.push(rel);
    } catch {
      failures.push(`${rel} (missing)`);
    }
  }
  return { ok: failures.length === 0, checked, failures };
}

export function writeManifest(packageDir: string, manifest: unknown): void {
  writeFileSync(join(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

export function readManifest(packageDir: string): any {
  return JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf-8'));
}
