const UP_MIGRATION_PATTERN = /^\d+_.*\.sql$/;
const DOWN_SUFFIX = '.down.sql';

function numericPrefix(filename: string): number {
  const match = /^(\d+)_/.exec(filename);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function isUpMigration(filename: string): boolean {
  return UP_MIGRATION_PATTERN.test(filename) && !filename.endsWith(DOWN_SUFFIX);
}

export function migrationVersion(filename: string): string {
  return filename.endsWith('.sql') ? filename.slice(0, -4) : filename;
}

export function listUpMigrations(filenames: string[]): string[] {
  return filenames
    .filter(isUpMigration)
    .sort((a, b) => numericPrefix(a) - numericPrefix(b) || a.localeCompare(b));
}

export function planPendingMigrations(
  filenames: string[],
  appliedVersions: Iterable<string>
): string[] {
  const applied = new Set(appliedVersions);
  return listUpMigrations(filenames).filter(filename => !applied.has(migrationVersion(filename)));
}

export function planRollback(
  appliedVersions: string[],
  filenames: string[]
): { version: string; downFile: string | null } | null {
  if (appliedVersions.length === 0) return null;

  const latest = [...appliedVersions].sort(
    (a, b) => numericPrefix(`${b}.sql`) - numericPrefix(`${a}.sql`) || b.localeCompare(a)
  )[0];
  const downFile = `${latest}${DOWN_SUFFIX}`;

  return {
    version: latest,
    downFile: filenames.includes(downFile) ? downFile : null,
  };
}
