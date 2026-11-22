import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, relative, resolve, sep } from 'path';

export function safeJoin(root: string, child: string): string {
  const base = resolve(root);
  const target = resolve(base, child);
  if (target !== base && !target.startsWith(base + sep)) throw new Error('PATH_TRAVERSAL');
  return target;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function walkFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

export function relativePosix(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}
