export function validateTargetDatabase(target: string, live: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(target)) throw new Error('INVALID_TARGET_DB');
  if (target === live) throw new Error('TARGET_IS_LIVE_DB');
}

export async function ensureTargetDatabase(admin: any, target: string): Promise<void> {
  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target]);
  if (rows.length > 0) throw new Error('TARGET_DB_EXISTS');
  await admin.query(`CREATE DATABASE "${target}"`);
}

export async function dropTargetDatabase(admin: any, target: string): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
}
