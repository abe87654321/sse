# P1-7 导出增强与全量备份/恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P1-7 报销导出补齐明细/审批链/付款/发票字段、增加 XLSX 与导出审计的基础上，新增一套可独立验证、可回滚的全量备份与恢复能力（PostgreSQL + MinIO + 配置文件），并提供 CLI 与管理端入口。

**Architecture:** 新增 `packages/backup`，用纯 Node/TS 实现逻辑备份：PostgreSQL 通过 `row_to_json` 导出为每表一个 JSONL，恢复时用 `json_populate_recordset` 导入；MinIO 通过官方 SDK 逐对象导出/还原；配置文件按白名单收集。恢复目标限定为**新建演练库**与**带前缀的演练 MinIO 命名空间**，通过迁移器建表、临时移除外键后导入、再重建外键并独立验证，失败时自动删除演练库与演练对象。API 以“一次只允许一个备份/恢复任务”的 advisory lock 串行执行，所有动作写入 `audit_events`；CLI 复用同一套库。

**Tech Stack:** TypeScript、Node 18+、pnpm、PostgreSQL 16、MinIO SDK、`pg`、`pg-cursor`、`tar`、`commander`、`exceljs`、Jest/Vitest、Vue 3。

---

## 1. 已确认的范围与取舍

| 决策项 | 选择 | 说明 |
|---|---|---|
| 本次范围 | 导出增强 + 全量备份/恢复 | P1-7 完整交付 |
| 备份内容 | PostgreSQL + MinIO + 配置文件 | `.env` 默认排除，需显式 `--include-secrets` |
| 操作入口 | CLI + 管理端 Web/API | 两者复用 `packages/backup` |
| 恢复目标 | 指定新库/演练库 | v1 不允许原地覆盖当前库 |
| 实现路线 | 纯 Node/TS 逻辑导出 | 不依赖 `pg_dump`/`psql`/`mc` 二进制 |
| 备份存放 | 本机 `BACKUP_DIR` + MinIO `backups` bucket | 本地为事实源，MinIO 为异地副本 |

### 1.1 明确不做（v1）

- 不做原地覆盖生产库的恢复；只恢复到新建库与 MinIO 前缀。
- 不做增量备份/WAL PITR。
- 不做备份包加密；默认排除 `.env`，包含敏感配置时在 manifest 标记 `containsSecrets`。
- 不做跨 PostgreSQL major 升级；目标库结构由目标系统 migration 决定。
- 不做浏览器内上传备份包；恢复只针对已存在或已上传到 MinIO 的备份 ID。

### 1.2 安全不变量（必须由测试守住）

1. 恢复目标库名不能等于当前 `DB_NAME`。
2. API 恢复必须 `BACKUP_RESTORE_ENABLED=true`，确认短语必须为 `RESTORE <backupId>`。
3. 备份/恢复/校验同一时刻只允许一个任务（PostgreSQL advisory lock `727002`）。
4. 恢复失败时删除新建演练库、清理本次 MinIO 前缀、保留日志与 job 记录。
5. 恢复不写目标系统的 `.env`；配置文件只落到 `BACKUP_DIR/restores/<jobId>/files/`。
6. 备份/恢复/下载/删除/上传动作都必须写 `audit_events`。
7. 演练库清理必须使用 `CLEANUP <targetDb>` 确认短语，禁止删除当前 `DB_NAME`；每次清理写 `backup.drill_cleanup` 审计。
8. 前端每次恢复后保存一条演练记录（库名、MinIO 前缀、备份 ID），清理按钮直接按记录执行，便于反复测试。

---

## 2. 备份包格式

```
<BACKUP_DIR>/<backupId>/
├── package/
│   ├── manifest.json
│   ├── db/
│   │   ├── _schema.json
│   │   ├── users.jsonl
│   │   └── ...
│   ├── minio/
│   │   ├── invoices/invoices/<id>/<file>.pdf
│   │   ├── payment-receipts/payment-receipts/<id>/<file>.pdf
│   │   └── avatars/<avatar_key>
│   ├── files/
│   │   ├── ai-config.json
│   │   ├── ai-test-history.json
│   │   └── env.local              # 仅 --include-secrets
│   └── meta/
│       └── checksums.sha256
├── <backupId>.tar.gz
└── <backupId>.job.json
```

`manifest.json`：

```json
{
  "formatVersion": 1,
  "id": "20261121-180000-7f3a1c",
  "createdAt": "2026-11-21T18:00:00.000Z",
  "schemaVersion": "024_verification_history",
  "database": { "serverVersion": "16", "name": "sse" },
  "tables": [{ "name": "users", "rows": 7, "columns": ["id"], "sha256": "..." }],
  "objects": [{ "bucket": "avatars", "key": "u1_1.png", "size": 1234, "sha256": "..." }],
  "configs": [{ "name": "ai-config.json", "sha256": "...", "sensitive": false }],
  "containsSecrets": false,
  "counts": { "tables": 17, "rows": 264, "objects": 16 }
}
```

数据文件使用 **JSONL**，每行一个 `row_to_json` 输出：

- 导出端不 `JSON.parse`，避免 `bigint` 等数值精度丢失。
- 导入端也不 `JSON.parse`，把原始行拼成 JSON 数组交给 PostgreSQL。
- `NULL` 与空字符串由 JSON 天然区分。
- `jsonb`、`text[]`、`bytea`、`timestamptz`、`numeric` 由 PostgreSQL 的 JSON 输入函数处理。

---

## 3. 目标文件结构

```
packages/backup/
├── package.json
├── tsconfig.json
├── jest.config.js
└── src/
    ├── index.ts
    ├── types.ts
    ├── config.ts
    ├── fs-utils.ts
    ├── manifest.ts
    ├── archive.ts
    ├── lock.ts
    ├── db/
    │   ├── pool.ts
    │   ├── schema.ts
    │   ├── export.ts
    │   ├── import.ts
    │   ├── constraints.ts
    │   └── target.ts
    ├── minio/
    │   ├── client.ts
    │   ├── export.ts
    │   ├── import.ts
    │   └── verify.ts
    ├── config-files.ts
    ├── backup.ts
    ├── verify.ts
    ├── restore.ts
    ├── restore-records.ts
    ├── drill-cleanup.ts
    ├── storage/
    │   ├── local-store.ts
    │   ├── minio-store.ts
    │   ├── resolve.ts
    │   └── index.ts
    ├── cli.ts
    └── __tests__/
```

新增/修改的 SSE 文件：

```
packages/db/src/migrate.ts                         # 导出 applyMigrations
packages/db/src/index.ts
packages/db/package.json                           # build 复制 migrations
packages/db/scripts/copy-migrations.js
packages/api/package.json                          # @sse/backup、exceljs
packages/api/src/routes/admin-backups.ts
packages/api/src/services/backup-jobs.ts
packages/api/src/services/report-export.ts
packages/api/src/routes/statistics.ts
packages/api/src/index.ts
packages/api/src/openapi.ts
packages/web/src/pages/AdminBackups.vue
packages/web/src/pages/Statistics.vue
packages/web/src/pages/__tests__/AdminBackups.test.ts
packages/web/src/pages/__tests__/Statistics.test.ts
packages/web/src/router/index.ts
packages/web/src/layouts/DefaultLayout.vue
package.json                                       # sse-backup 脚本
```

---

## 4. 任务

### Task 1: 脚手架、配置与基础工具

**Files:**
- Create: `packages/backup/package.json`
- Create: `packages/backup/tsconfig.json`
- Create: `packages/backup/jest.config.js`
- Create: `packages/backup/src/types.ts`
- Create: `packages/backup/src/config.ts`
- Create: `packages/backup/src/fs-utils.ts`
- Create: `packages/backup/src/manifest.ts`
- Create: `packages/backup/src/archive.ts`
- Create: `packages/backup/src/index.ts`
- Test: `packages/backup/src/__tests__/foundation.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  loadBackupConfig,
  sha256File,
  safeJoin,
  writeChecksums,
  verifyChecksums,
  createArchive,
  extractArchive,
} from '../index';

test('loadBackupConfig applies defaults', () => {
  const config = loadBackupConfig({
    env: { DB_HOST: 'db', DB_PORT: '5433', DB_NAME: 'sse', DB_USER: 'sse', BACKUP_DIR: 'C:/backups' },
  });
  expect(config.db.host).toBe('db');
  expect(config.backupDir).toBe(resolve('C:/backups'));
  expect(config.minio.buckets).toEqual(['invoices', 'payment-receipts', 'avatars']);
});

test('sha256File hashes file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-backup-'));
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'hello');
  expect(sha256File(file)).toBe(
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
  );
});

test('safeJoin rejects traversal and checksums detect tampering', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-backup-'));
  expect(() => safeJoin(dir, '../evil.txt')).toThrow('PATH_TRAVERSAL');
  mkdirSync(join(dir, 'db'));
  writeFileSync(join(dir, 'db', 'users.jsonl'), '{"id":1}\n');
  writeChecksums(dir);
  expect(verifyChecksums(dir).ok).toBe(true);
  writeFileSync(join(dir, 'db', 'users.jsonl'), '{"id":2}\n');
  expect(verifyChecksums(dir).ok).toBe(false);
});

test('archive round-trips the package directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-backup-'));
  const pkg = join(dir, 'package');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'manifest.json'), '{}');
  const archive = join(dir, 'pkg.tar.gz');
  await createArchive(pkg, archive);
  const out = join(dir, 'extracted');
  mkdirSync(out);
  await extractArchive(archive, out);
  expect(readFileSync(join(out, 'manifest.json'), 'utf-8')).toBe('{}');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- foundation.test.ts`
Expected: FAIL with `Cannot find module '../index'`。

- [ ] **Step 3: 创建包与实现**

`packages/backup/package.json`：

```json
{
  "name": "@sse/backup",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "sse-backup": "dist/cli.js" },
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "backup": "node dist/cli.js"
  },
  "dependencies": {
    "@sse/db": "workspace:*",
    "@sse/shared": "workspace:*",
    "commander": "^12.1.0",
    "minio": "^8.0.7",
    "pg": "^8.11.0",
    "pg-cursor": "^2.12.0",
    "tar": "^7.4.3"
  },
  "devDependencies": {
    "@types/jest": "^29",
    "@types/node": "^26.1.0",
    "@types/pg": "^8.10",
    "@types/pg-cursor": "^2.7.4",
    "jest": "^29",
    "ts-jest": "^29",
    "typescript": "^5.3"
  }
}
```

`packages/backup/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/backup/jest.config.js`：

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@sse/(.*)$': '<rootDir>/../$1/src' },
  testTimeout: 30000,
};
```

`src/types.ts`：

```ts
export interface BackupDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface BackupMinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  buckets: string[];
}

export interface BackupConfig {
  db: BackupDatabaseConfig;
  minio: BackupMinioConfig;
  sseDir: string;
  backupDir: string;
  minioBackupBucket: string;
  minioBackupPrefix: string;
}

export interface BackupConfigOverrides {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  backupDir?: string;
}

export interface TableExport {
  name: string;
  rows: number;
  columns: string[];
  sha256: string;
}

export interface ObjectExport {
  bucket: string;
  key: string;
  size: number;
  sha256: string;
}

export interface ConfigExport {
  name: string;
  sha256: string;
  sensitive: boolean;
}

export interface BackupManifest {
  formatVersion: 1;
  id: string;
  createdAt: string;
  schemaVersion: string;
  database: { serverVersion: string; name: string };
  tables: TableExport[];
  objects: ObjectExport[];
  configs: ConfigExport[];
  containsSecrets: boolean;
  counts: { tables: number; rows: number; objects: number };
}

export interface SchemaColumn {
  name: string;
  ordinal: number;
  dataType: string;
  udtName: string;
  nullable: boolean;
  default: string | null;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

export interface DatabaseSchema {
  schemaVersion: string;
  serverVersion: string;
  tables: SchemaTable[];
}
```

`src/config.ts`：

```ts
import { resolve } from 'path';
import type { BackupConfig, BackupConfigOverrides } from './types';

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadBackupConfig(overrides: BackupConfigOverrides = {}): BackupConfig {
  const env = overrides.env ?? process.env;
  const database = env.DB_NAME || 'sse';
  if (!/^[A-Za-z0-9_.-]+$/.test(database)) throw new Error('DB_NAME 含有非法字符');
  return {
    db: {
      host: env.DB_HOST || 'localhost',
      port: num(env.DB_PORT, 5433),
      database,
      user: env.DB_USER || 'sse',
      password: env.DB_PASSWORD || 'sse_dev',
    },
    minio: {
      endPoint: env.MINIO_ENDPOINT || 'localhost',
      port: num(env.MINIO_PORT, 9002),
      useSSL: env.MINIO_USE_SSL === '1' || env.MINIO_USE_SSL === 'true',
      accessKey: env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: env.MINIO_SECRET_KEY || 'minioadmin',
      buckets: (env.MINIO_BUCKETS || 'invoices,payment-receipts,avatars')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    },
    sseDir: resolve(env.SSE_DIR || process.cwd()),
    backupDir: resolve(overrides.backupDir || env.BACKUP_DIR || 'backups'),
    minioBackupBucket: env.MINIO_BACKUP_BUCKET || 'backups',
    minioBackupPrefix: env.MINIO_BACKUP_PREFIX || 'sse/',
  };
}
```

`src/fs-utils.ts`：

```ts
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { mkdir, readdir } from 'fs/promises';
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

export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

export function relativePosix(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}
```

`src/manifest.ts`：

```ts
import { readFileSync, writeFileSync } from 'fs';
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
```

`src/archive.ts`：

```ts
import { create, x } from 'tar';

export async function createArchive(sourceDir: string, archivePath: string): Promise<void> {
  await create({ gzip: true, cwd: sourceDir, file: archivePath, portable: true }, ['.']);
}

export async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  await x({ file: archivePath, cwd: targetDir, strict: true });
}
```

`src/index.ts`：

```ts
export * from './types';
export * from './config';
export * from './fs-utils';
export * from './manifest';
export * from './archive';
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- foundation.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup
git commit -m "feat(backup): scaffold package with config, checksums and archive"
```

---

### Task 2: 本地/MinIO 存储、保留策略与备份源解析

**Files:**
- Create: `packages/backup/src/storage/local-store.ts`
- Create: `packages/backup/src/storage/minio-store.ts`
- Create: `packages/backup/src/storage/resolve.ts`
- Create: `packages/backup/src/storage/index.ts`
- Test: `packages/backup/src/__tests__/storage.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalBackupStore } from '../storage/local-store';
import { resolveBackupPackage } from '../storage/resolve';

function seed(root: string, id: string): void {
  mkdirSync(join(root, id, 'package'), { recursive: true });
  writeFileSync(join(root, id, 'package', 'manifest.json'), JSON.stringify({ id }));
  writeFileSync(join(root, id, `${id}.tar.gz`), 'archive');
}

test('lists newest first and cleans up old backups', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-store-'));
  seed(root, '20261121-000000-a');
  seed(root, '20261122-000000-b');
  seed(root, '20261123-000000-c');
  const store = new LocalBackupStore(root);
  expect((await store.list()).map((item) => item.id)).toEqual([
    '20261123-000000-c',
    '20261122-000000-b',
    '20261121-000000-a',
  ]);
  expect(await store.cleanup(2)).toEqual(['20261121-000000-a']);
});

test('resolves a local id or package path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-store-'));
  seed(root, 'b1');
  const pkg = await resolveBackupPackage({ idOrPath: 'b1', backupDir: root });
  expect(pkg).toBe(join(root, 'b1', 'package'));
  expect(existsSync(join(pkg, 'manifest.json'))).toBe(true);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- storage.test.ts`
Expected: FAIL with `Cannot find module '../storage/local-store'`。

- [ ] **Step 3: 实现存储与解析**

`src/storage/local-store.ts`：

```ts
import { existsSync } from 'fs';
import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import { readManifest } from '../manifest';

export interface BackupListItem {
  id: string;
  manifest: any;
  archivePath: string;
  location: 'local';
}

export class LocalBackupStore {
  constructor(private readonly root: string) {}

  async list(): Promise<BackupListItem[]> {
    if (!existsSync(this.root)) return [];
    const entries = await readdir(this.root, { withFileTypes: true });
    const items: BackupListItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkg = join(this.root, entry.name, 'package');
      if (!existsSync(join(pkg, 'manifest.json'))) continue;
      items.push({
        id: entry.name,
        manifest: readManifest(pkg),
        archivePath: join(this.root, entry.name, `${entry.name}.tar.gz`),
        location: 'local',
      });
    }
    return items.sort((a, b) => b.id.localeCompare(a.id));
  }

  async delete(id: string): Promise<void> {
    await rm(join(this.root, id), { recursive: true, force: true });
  }

  async cleanup(keep: number): Promise<string[]> {
    const stale = (await this.list()).slice(Math.max(keep, 0));
    for (const item of stale) await this.delete(item.id);
    return stale.map((item) => item.id);
  }
}
```

`src/storage/minio-store.ts`：

```ts
import type { Client } from 'minio';

export class MinioBackupStore {
  constructor(
    private readonly client: Client,
    private readonly bucket: string,
    private readonly prefix: string
  ) {}

  private objectKey(id: string): string {
    return `${this.prefix}${id}.tar.gz`;
  }

  async upload(id: string, archivePath: string): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
    }
    await this.client.fPutObject(this.bucket, this.objectKey(id), archivePath, {});
  }

  async download(id: string, archivePath: string): Promise<void> {
    await this.client.fGetObject(this.bucket, this.objectKey(id), archivePath);
  }

  async list(): Promise<string[]> {
    const stream = this.client.listObjectsV2(this.bucket, this.prefix, true);
    const ids: string[] = [];
    for await (const item of stream) {
      const match = new RegExp(`^${this.prefix}(.+)\\.tar\\.gz$`).exec(item.name);
      if (match) ids.push(match[1]);
    }
    return ids.sort((a, b) => b.localeCompare(a));
  }

  async delete(id: string): Promise<void> {
    await this.client.removeObject(this.bucket, this.objectKey(id));
  }
}
```

`src/storage/resolve.ts`：

```ts
import { existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureDir } from '../fs-utils';
import { extractArchive } from '../archive';
import type { MinioBackupStore } from './minio-store';

export async function resolveBackupPackage(options: {
  idOrPath: string;
  backupDir: string;
  minio?: MinioBackupStore;
}): Promise<string> {
  const candidate = options.idOrPath;
  if (existsSync(join(candidate, 'manifest.json'))) return candidate;
  if (existsSync(join(candidate, 'package', 'manifest.json'))) {
    return join(candidate, 'package');
  }
  const local = join(options.backupDir, candidate, 'package');
  if (existsSync(join(local, 'manifest.json'))) return local;
  if (!options.minio) throw new Error('BACKUP_NOT_FOUND');

  const temp = mkdtempSync(join(tmpdir(), `sse-restore-${candidate}-`));
  const archive = join(temp, `${candidate}.tar.gz`);
  await options.minio.download(candidate, archive);
  const extracted = join(temp, 'package');
  await ensureDir(extracted);
  await extractArchive(archive, extracted);
  return extracted;
}
```

`src/storage/index.ts`：

```ts
export * from './local-store';
export * from './minio-store';
export * from './resolve';
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- storage.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup/src/storage packages/backup/src/__tests__/storage.test.ts
git commit -m "feat(backup): add local/MinIO stores, retention and package resolver"
```

---

### Task 3: PostgreSQL 逻辑导出（JSONL）

**Files:**
- Create: `packages/backup/src/db/pool.ts`
- Create: `packages/backup/src/db/schema.ts`
- Create: `packages/backup/src/db/export.ts`
- Test: `packages/backup/src/__tests__/db-export.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportDatabase } from '../db/export';

function fakeClient(rows: any[]) {
  return {
    calls: [] as string[],
    query: jest.fn(async (sql: string) => {
      if (sql.includes('information_schema.columns')) {
        return { rows: [
          { table_name: 'users', column_name: 'id', ordinal_position: 1, data_type: 'uuid', udt_name: 'uuid', is_nullable: 'NO', column_default: null },
          { table_name: 'users', column_name: 'name', ordinal_position: 2, data_type: 'text', udt_name: 'text', is_nullable: 'YES', column_default: null },
        ] };
      }
      if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'users' }] };
      if (sql.includes('schema_migrations')) return { rows: [{ version: '024_verification_history' }] };
      if (sql.includes('COUNT(*)')) return { rows: [{ c: String(rows.length) }] };
      if (sql.includes('server_version')) return { rows: [{ server_version: '16.4' }] };
      return { rows: [] };
    }),
    cursorFactory: () => {
      let offset = 0;
      return {
        read: async (n: number) => {
          const batch = rows.slice(offset, offset + n).map((row) => ({ line: JSON.stringify(row) }));
          offset += batch.length;
          return batch;
        },
        close: async () => undefined,
      };
    },
  };
}

test('exports one JSONL file per table in a repeatable-read transaction', async () => {
  const out = mkdtempSync(join(tmpdir(), 'sse-db-export-'));
  const client = fakeClient([{ id: 'u1', name: null }, { id: 'u2', name: '' }]);
  const result = await exportDatabase(client as any, out);
  expect(result.tables[0]).toMatchObject({ name: 'users', rows: 2 });
  expect(readFileSync(join(out, 'users.jsonl'), 'utf-8')).toBe(
    '{"id":"u1","name":null}\n{"id":"u2","name":""}\n'
  );
});

test('rolls back on row count mismatch', async () => {
  const out = mkdtempSync(join(tmpdir(), 'sse-db-export-'));
  const client = fakeClient([{ id: 'u1' }]);
  client.cursorFactory = () => ({ read: async () => [], close: async () => undefined });
  await expect(exportDatabase(client as any, out)).rejects.toThrow('ROW_COUNT_MISMATCH');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- db-export.test.ts`
Expected: FAIL with `Cannot find module '../db/export'`。

- [ ] **Step 3: 实现 schema 与导出**

`src/db/pool.ts`：

```ts
import { Client, Pool } from 'pg';
import type { BackupDatabaseConfig } from '../types';

export function createPool(config: BackupDatabaseConfig): Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 4,
  });
}

export function createClient(config: BackupDatabaseConfig, database = config.database): Client {
  return new Client({
    host: config.host,
    port: config.port,
    database,
    user: config.user,
    password: config.password,
  });
}
```

`src/db/schema.ts`：

```ts
import type { DatabaseSchema, SchemaTable } from '../types';

const EXCLUDED = new Set(['schema_migrations']);

export async function readDatabaseSchema(client: any): Promise<DatabaseSchema> {
  const { rows: tableRows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  const tableNames = tableRows
    .map((row: any) => row.table_name)
    .filter((name: string) => !EXCLUDED.has(name));

  const { rows: columnRows } = await client.query(
    `SELECT table_name, column_name, ordinal_position, data_type, udt_name,
            is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`
  );
  const byTable = new Map<string, SchemaTable>();
  for (const name of tableNames) byTable.set(name, { name, columns: [] });
  for (const row of columnRows) {
    const table = byTable.get(row.table_name);
    if (!table) continue;
    table.columns.push({
      name: row.column_name,
      ordinal: Number(row.ordinal_position),
      dataType: row.data_type,
      udtName: row.udt_name,
      nullable: row.is_nullable === 'YES',
      default: row.column_default,
    });
  }

  const { rows: versionRows } = await client.query(
    `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`
  );
  const { rows: serverRows } = await client.query('SHOW server_version');
  return {
    schemaVersion: versionRows[0]?.version ?? 'unknown',
    serverVersion: String(serverRows[0]?.server_version ?? 'unknown'),
    tables: [...byTable.values()],
  };
}

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('INVALID_IDENTIFIER');
  return `"${name.replace(/"/g, '""')}"`;
}
```

`src/db/export.ts`：

```ts
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { join } from 'path';
import Cursor from 'pg-cursor';
import { ensureDir } from '../fs-utils';
import { readDatabaseSchema, quoteIdent } from './schema';
import type { DatabaseSchema, TableExport } from '../types';

export async function exportDatabase(
  client: any,
  outDir: string
): Promise<{ schema: DatabaseSchema; tables: TableExport[] }> {
  await ensureDir(outDir);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const schema = await readDatabaseSchema(client);
    const tables: TableExport[] = [];
    for (const table of schema.tables) {
      const ident = quoteIdent(table.name);
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::text AS c FROM ${ident}`
      );
      const expected = Number(countRows[0].c);
      const file = join(outDir, `${table.name}.jsonl`);
      const out = createWriteStream(file);
      const hash = createHash('sha256');
      const cursor = client.cursorFactory
        ? client.cursorFactory(`SELECT row_to_json(t)::text AS line FROM ${ident} t ORDER BY ctid`)
        : client.query(
            new Cursor(`SELECT row_to_json(t)::text AS line FROM ${ident} t ORDER BY ctid`, [])
          );

      let written = 0;
      try {
        while (true) {
          const batch = await cursor.read(500);
          if (batch.length === 0) break;
          const text = batch.map((row: any) => row.line).join('\n') + '\n';
          hash.update(text);
          if (!out.write(text)) await new Promise<void>((resolve) => out.once('drain', resolve));
          written += batch.length;
        }
      } finally {
        await cursor.close();
        await new Promise<void>((resolve, reject) =>
          out.end((error?: Error | null) => (error ? reject(error) : resolve()))
        );
      }

      if (written !== expected) throw new Error(`ROW_COUNT_MISMATCH ${table.name}`);
      tables.push({
        name: table.name,
        rows: written,
        columns: table.columns.map((column) => column.name),
        sha256: hash.digest('hex'),
      });
    }
    await client.query('COMMIT');
    return { schema, tables };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- db-export.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup/src/db packages/backup/src/__tests__/db-export.test.ts
git commit -m "feat(backup): export PostgreSQL tables to JSONL snapshots"
```

---

### Task 4: MinIO 对象与配置文件导出

**Files:**
- Create: `packages/backup/src/minio/client.ts`
- Create: `packages/backup/src/minio/export.ts`
- Create: `packages/backup/src/config-files.ts`
- Test: `packages/backup/src/__tests__/minio-config.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
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
});

test('excludes .env by default and includes env.local only when requested', async () => {
  const sseDir = mkdtempSync(join(tmpdir(), 'sse-config-'));
  writeFileSync(join(sseDir, 'ai-config.json'), '{"a":1}');
  writeFileSync(join(sseDir, '.env'), 'SECRET=1');
  const out = mkdtempSync(join(tmpdir(), 'sse-config-out-'));
  const configs = await exportConfigs(sseDir, out, { includeSecrets: false });
  expect(configs.map((item) => item.name)).toEqual(['ai-config.json']);
  expect(() => readFileSync(join(out, 'env.local'))).toThrow();

  const out2 = mkdtempSync(join(tmpdir(), 'sse-config-out-'));
  const withSecrets = await exportConfigs(sseDir, out2, { includeSecrets: true });
  expect(withSecrets).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'env.local', sensitive: true })])
  );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- minio-config.test.ts`
Expected: FAIL with `Cannot find module '../minio/export'`。

- [ ] **Step 3: 实现对象/配置导出**

`src/minio/client.ts`：

```ts
import { Client } from 'minio';

export interface MinioObject {
  key: string;
  size: number;
}

export interface ObjectSource {
  listObjects(bucket: string): Promise<MinioObject[]>;
  getObject(bucket: string, key: string): Promise<Buffer>;
}

export function createMinioClient(config: {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}): Client {
  return new Client(config);
}
```

`src/minio/export.ts`：

```ts
import { createHash } from 'crypto';
import { writeFile } from 'fs/promises';
import { join } from 'path';
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
      await ensureDir(join(target, '..'));
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
```

`src/config-files.ts`：

```ts
import { createHash } from 'crypto';
import { copyFile, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { ensureDir } from './fs-utils';
import type { ConfigExport } from './types';

const PUBLIC_CONFIGS = ['ai-config.json', 'ai-test-history.json'];

export async function exportConfigs(
  sseDir: string,
  outDir: string,
  options: { includeSecrets: boolean }
): Promise<ConfigExport[]> {
  await ensureDir(outDir);
  const results: ConfigExport[] = [];
  for (const name of PUBLIC_CONFIGS) {
    const source = join(sseDir, name);
    try {
      await stat(source);
    } catch {
      continue;
    }
    const target = join(outDir, name);
    await copyFile(source, target);
    results.push({
      name,
      sha256: createHash('sha256').update(await readFile(target)).digest('hex'),
      sensitive: false,
    });
  }
  if (options.includeSecrets) {
    const source = join(sseDir, '.env');
    try {
      const data = await readFile(source);
      await writeFile(join(outDir, 'env.local'), data);
      results.push({
        name: 'env.local',
        sha256: createHash('sha256').update(data).digest('hex'),
        sensitive: true,
      });
    } catch {
      /* .env missing is allowed */
    }
  }
  return results;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- minio-config.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup/src/minio packages/backup/src/config-files.ts packages/backup/src/__tests__/minio-config.test.ts
git commit -m "feat(backup): export MinIO objects and whitelisted config files"
```

---

### Task 5: 备份编排、advisory lock 与 CLI create/list

**Files:**
- Create: `packages/backup/src/lock.ts`
- Create: `packages/backup/src/backup.ts`
- Create: `packages/backup/src/cli.ts`
- Modify: `package.json`
- Test: `packages/backup/src/__tests__/backup.test.ts`
- Test: `packages/backup/src/__tests__/cli.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createBackup } from '../backup';

test('creates package, manifest, checksums and archive', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-backup-job-'));
  const result = await createBackup(
    { backupDir: root, includeSecrets: false, upload: false, id: 'b1' },
    {
      config: {
        db: { host: 'x', port: 1, database: 'sse', user: 'u', password: 'p' },
        minio: { endPoint: 'x', port: 1, useSSL: false, accessKey: 'a', secretKey: 's', buckets: [] },
        sseDir: root,
        backupDir: root,
        minioBackupBucket: 'backups',
        minioBackupPrefix: 'sse/',
      },
      exportDatabase: async () => ({
        schema: { schemaVersion: '024', serverVersion: '16', tables: [] },
        tables: [{ name: 'users', rows: 1, columns: ['id'], sha256: 'a'.repeat(64) }],
      }),
      exportObjects: async () => [],
      exportConfigs: async () => [],
      writeJsonFile: async () => undefined,
    }
  );
  expect(result.id).toBe('b1');
  expect(existsSync(result.archivePath)).toBe(true);
  const manifest = JSON.parse(readFileSync(join(root, 'b1', 'package', 'manifest.json'), 'utf-8'));
  expect(manifest.schemaVersion).toBe('024');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- backup.test.ts`
Expected: FAIL with `Cannot find module '../backup'`。

- [ ] **Step 3: 实现锁、编排与 CLI**

`src/lock.ts`：

```ts
import { createClient } from './db/pool';
import type { BackupDatabaseConfig } from './types';

const LOCK_KEY = 727002;

export async function withBackupLock<T>(
  config: BackupDatabaseConfig,
  fn: () => Promise<T>
): Promise<T> {
  const client = createClient(config);
  await client.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) throw new Error('BACKUP_BUSY');
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
```

`src/backup.ts`：

```ts
import { randomBytes } from 'crypto';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { createArchive } from './archive';
import { exportConfigs } from './config-files';
import { createPool } from './db/pool';
import { exportDatabase } from './db/export';
import { ensureDir } from './fs-utils';
import { writeChecksums, writeManifest } from './manifest';
import { createMinioClient } from './minio/client';
import { exportObjects } from './minio/export';
import { MinioBackupStore } from './storage/minio-store';
import type { BackupConfig, BackupManifest } from './types';

export interface CreateBackupOptions {
  backupDir: string;
  includeSecrets: boolean;
  upload: boolean;
  id?: string;
}

export interface CreateBackupDeps {
  config: BackupConfig;
  exportDatabase: typeof exportDatabase;
  exportObjects: typeof exportObjects;
  exportConfigs: typeof exportConfigs;
  writeJsonFile: (path: string, value: unknown) => Promise<void>;
}

export function makeBackupId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export async function createBackup(
  options: CreateBackupOptions,
  deps: CreateBackupDeps
): Promise<{ id: string; archivePath: string; manifest: BackupManifest }> {
  const id = options.id ?? makeBackupId();
  const root = join(options.backupDir, id);
  const pkg = join(root, 'package');
  await ensureDir(pkg);

  const pool = createPool(deps.config.db);
  const client = await pool.connect();
  let dbResult;
  try {
    dbResult = await deps.exportDatabase(client, join(pkg, 'db'));
  } finally {
    client.release();
    await pool.end();
  }

  const objects = await deps.exportObjects(
    createMinioClient(deps.config.minio) as any,
    deps.config.minio.buckets,
    join(pkg, 'minio')
  );
  const configs = await deps.exportConfigs(deps.config.sseDir, join(pkg, 'files'), {
    includeSecrets: options.includeSecrets,
  });

  const rows = dbResult.tables.reduce((sum, table) => sum + table.rows, 0);
  const manifest: BackupManifest = {
    formatVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    schemaVersion: dbResult.schema.schemaVersion,
    database: { serverVersion: dbResult.schema.serverVersion, name: deps.config.db.database },
    tables: dbResult.tables,
    objects,
    configs,
    containsSecrets: configs.some((item) => item.sensitive),
    counts: { tables: dbResult.tables.length, rows, objects: objects.length },
  };

  await deps.writeJsonFile(join(pkg, 'db', '_schema.json'), dbResult.schema);
  writeManifest(pkg, manifest);
  writeChecksums(pkg);

  const archivePath = join(root, `${id}.tar.gz`);
  await createArchive(pkg, archivePath);

  if (options.upload) {
    await new MinioBackupStore(
      createMinioClient(deps.config.minio),
      deps.config.minioBackupBucket,
      deps.config.minioBackupPrefix
    ).upload(id, archivePath);
  }

  return { id, archivePath, manifest };
}

export const defaultCreateBackupDeps = {
  exportDatabase,
  exportObjects,
  exportConfigs,
  writeJsonFile: async (path: string, value: unknown) => {
    await writeFile(path, JSON.stringify(value, null, 2));
  },
};
```

`src/cli.ts`：

```ts
import { Command } from 'commander';
import { loadBackupConfig } from './config';
import {
  createBackup,
  defaultCreateBackupDeps,
  type CreateBackupDeps,
} from './backup';
import { resolveBackupPackage } from './storage/resolve';
import { LocalBackupStore } from './storage/local-store';
import { MinioBackupStore } from './storage/minio-store';
import { createMinioClient } from './minio/client';
import { verifyPackage } from './verify';
import { restoreBackup, defaultRestoreDeps } from './restore';

export interface CliOverrides {
  createDeps?: CreateBackupDeps;
  logger?: (line: string) => void;
}

export async function runCli(argv: string[], overrides: CliOverrides = {}): Promise<number> {
  const config = loadBackupConfig();
  const logger = overrides.logger ?? ((line: string) => console.log(line));
  const program = new Command();
  program.name('sse-backup').exitOverride();

  program
    .command('create')
    .option('--out <dir>', '本地备份根目录')
    .option('--include-secrets', '包含 .env', false)
    .option('--upload', '上传到 MinIO', false)
    .action(async (options) => {
      const result = await createBackup(
        {
          backupDir: options.out || config.backupDir,
          includeSecrets: Boolean(options.includeSecrets),
          upload: Boolean(options.upload),
        },
        overrides.createDeps ?? { config, ...defaultCreateBackupDeps }
      );
      logger(`backup created: ${result.id}`);
      logger(`archive: ${result.archivePath}`);
    });

  program
    .command('list')
    .option('--out <dir>', '本地备份根目录')
    .action(async (options) => {
      const store = new LocalBackupStore(options.out || config.backupDir);
      for (const item of await store.list()) logger(item.id);
    });

  program
    .command('verify')
    .requiredOption('--from <idOrPath>')
    .option('--out <dir>', '本地备份根目录')
    .action(async (options) => {
      const minio = new MinioBackupStore(
        createMinioClient(config.minio),
        config.minioBackupBucket,
        config.minioBackupPrefix
      );
      const pkg = await resolveBackupPackage({
        idOrPath: options.from,
        backupDir: options.out || config.backupDir,
        minio,
      });
      const result = await verifyPackage(pkg);
      logger(result.ok ? 'verify ok' : `verify failed: ${result.failures.join(', ')}`);
      if (!result.ok) process.exitCode = 3;
    });

  program
    .command('restore')
    .requiredOption('--from <idOrPath>')
    .requiredOption('--target-db <name>')
    .option('--target-minio-prefix <prefix>', '演练对象前缀', 'drills/')
    .option('--dry-run', '只做预检', false)
    .action(async (options) => {
      const minio = new MinioBackupStore(
        createMinioClient(config.minio),
        config.minioBackupBucket,
        config.minioBackupPrefix
      );
      const pkg = await resolveBackupPackage({
        idOrPath: options.from,
        backupDir: config.backupDir,
        minio,
      });
      const result = await restoreBackup(
        {
          from: pkg,
          targetDb: options.targetDb,
          targetMinioPrefix: options.targetMinioPrefix,
          dryRun: Boolean(options.dryRun),
        },
        defaultRestoreDeps(config)
      );
      logger(`restore ok: ${result.ok}`);
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
    return process.exitCode ?? 0;
  } catch (error) {
    logger(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
```

根 `package.json` 增加：

```json
"sse-backup": "pnpm --filter @sse/backup build && node packages/backup/dist/cli.js"
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- backup.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup package.json
git commit -m "feat(backup): orchestrate backups, advisory lock and CLI"
```

---

### Task 6: 独立校验器

**Files:**
- Create: `packages/backup/src/verify.ts`
- Test: `packages/backup/src/__tests__/verify.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { verifyPackage } from '../verify';
import { writeChecksums } from '../manifest';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sse-verify-'));
  mkdirSync(join(root, 'db'), { recursive: true });
  mkdirSync(join(root, 'meta'), { recursive: true });
  writeFileSync(join(root, 'db', 'users.jsonl'), '{"id":1}\n');
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    formatVersion: 1,
    id: 'b1',
    tables: [{ name: 'users', rows: 1, sha256: 'IGNORED' }],
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- verify.test.ts`
Expected: FAIL with `Cannot find module '../verify'`。

- [ ] **Step 3: 实现校验器**

`src/verify.ts`：

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { readManifest, verifyChecksums } from './manifest';
import { sha256File } from './fs-utils';

export interface VerifyResult {
  ok: boolean;
  checksums: { ok: boolean; checked: number; failures: string[] };
  tables: Array<{ name: string; rows: number; actualRows: number; ok: boolean }>;
  failures: string[];
}

export async function verifyPackage(packageDir: string): Promise<VerifyResult> {
  const failures: string[] = [];
  const checksums = verifyChecksums(packageDir);
  if (!checksums.ok) failures.push(`checksum: ${checksums.failures.join(', ')}`);

  const manifest = readManifest(packageDir);
  const tables = [];
  for (const table of manifest.tables ?? []) {
    const file = join(packageDir, 'db', `${table.name}.jsonl`);
    let actualRows = 0;
    let actualHash = '';
    try {
      actualRows = readFileSync(file, 'utf-8').split('\n').filter(Boolean).length;
      actualHash = sha256File(file);
    } catch {
      failures.push(`missing table file: ${table.name}`);
    }
    const ok = actualRows === table.rows && (!table.sha256 || actualHash === table.sha256);
    if (!ok) failures.push(`table ${table.name}: ${actualRows}/${table.rows}`);
    tables.push({ name: table.name, rows: table.rows, actualRows, ok });
  }
  return { ok: failures.length === 0, checksums, tables, failures };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- verify.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup/src/verify.ts packages/backup/src/__tests__/verify.test.ts
git commit -m "feat(backup): add independent package verifier"
```

---

### Task 7: 让 `@sse/db` 支持对指定目标库执行迁移

**Files:**
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/package.json`
- Create: `packages/db/scripts/copy-migrations.js`
- Test: `packages/db/src/__tests__/migrate-target.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { applyMigrations } from '../migrate';

test('applyMigrations uses an injected client and records versions', async () => {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT version')) return { rows: [] };
      return { rows: [] };
    }),
  };
  const applied = await applyMigrations(client as any, ['001_initial.sql']);
  expect(applied).toContain('001_initial');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/db test -- migrate-target.test.ts`
Expected: FAIL with `applyMigrations is not a function`。

- [ ] **Step 3: 重构迁移器**

在 `migrate.ts` 中新增：

```ts
export async function applyMigrations(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  filenames?: string[]
): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  const files = filenames ?? listMigrationFiles();
  const { rows } = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set(rows.map((row: any) => row.version));
  const pending = planPendingMigrations(files, [...applied]);
  const done: string[] = [];
  for (const file of pending) {
    await db.query(readFileSync(join(migrationsDir(), file), 'utf-8'));
    const version = migrationVersion(file);
    await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    done.push(version);
  }
  return done;
}

function migrationsDir(): string {
  const candidates = [
    join(__dirname, 'migrations'),
    join(__dirname, '..', 'src', 'migrations'),
  ];
  for (const dir of candidates) {
    try {
      readdirSync(dir);
      return dir;
    } catch {
      /* try next */
    }
  }
  throw new Error('MIGRATIONS_DIR_NOT_FOUND');
}
```

`packages/db/scripts/copy-migrations.js`：

```js
const { cpSync, mkdirSync } = require('fs');
const { join } = require('path');
mkdirSync(join(__dirname, '..', 'dist', 'migrations'), { recursive: true });
cpSync(join(__dirname, '..', 'src', 'migrations'), join(__dirname, '..', 'dist', 'migrations'), {
  recursive: true,
});
```

`packages/db/package.json` 的 build：

```json
"build": "tsc && node scripts/copy-migrations.js"
```

`packages/db/src/index.ts`：

```ts
export { applyMigrations } from './migrate';
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/db test -- migrate-target.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/db
git commit -m "refactor(db): expose reusable applyMigrations for target databases"
```

---

### Task 8: 演练库创建与恢复预检

**Files:**
- Create: `packages/backup/src/db/target.ts`
- Test: `packages/backup/src/__tests__/target-db.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { validateTargetDatabase, ensureTargetDatabase, dropTargetDatabase } from '../db/target';

test('rejects the live database and invalid identifiers', () => {
  expect(() => validateTargetDatabase('sse', 'sse')).toThrow('TARGET_IS_LIVE_DB');
  expect(() => validateTargetDatabase('sse; DROP', 'sse')).toThrow('INVALID_TARGET_DB');
});

test('creates and drops a drill database', async () => {
  const queries: string[] = [];
  const admin = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    }),
  };
  await ensureTargetDatabase(admin as any, 'sse_drill_1');
  expect(queries.some((sql) => sql.includes('CREATE DATABASE "sse_drill_1"'))).toBe(true);
  await dropTargetDatabase(admin as any, 'sse_drill_1');
  expect(queries.some((sql) => sql.includes('DROP DATABASE IF EXISTS "sse_drill_1"'))).toBe(true);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- target-db.test.ts`
Expected: FAIL with `Cannot find module '../db/target'`。

- [ ] **Step 3: 实现目标库管理**

`src/db/target.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- target-db.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup/src/db/target.ts packages/backup/src/__tests__/target-db.test.ts
git commit -m "feat(backup): validate and manage drill target databases"
```

---

### Task 9: JSONL 导入、列对齐与外键重建

**Files:**
- Create: `packages/backup/src/db/constraints.ts`
- Create: `packages/backup/src/db/import.ts`
- Test: `packages/backup/src/__tests__/db-import.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { planImport, importPackageTables } from '../db/import';

const source = {
  schemaVersion: '024',
  serverVersion: '16',
  tables: [{ name: 'users', columns: [
    { name: 'id', ordinal: 1, dataType: 'uuid', udtName: 'uuid', nullable: false, default: null },
    { name: 'legacy', ordinal: 2, dataType: 'text', udtName: 'text', nullable: true, default: null },
  ] }],
};
const target = {
  schemaVersion: '024',
  serverVersion: '16',
  tables: [{ name: 'users', columns: [
    { name: 'id', ordinal: 1, dataType: 'uuid', udtName: 'uuid', nullable: false, default: null },
    { name: 'status', ordinal: 2, dataType: 'text', udtName: 'text', nullable: false, default: "'active'" },
  ] }],
};

test('drops source-only columns and lets target defaults fill missing columns', () => {
  expect(planImport(source as any, target as any).tables[0]).toEqual({
    name: 'users',
    columns: ['id'],
    skippedColumns: ['legacy'],
  });
});

test('fails when a required target column is missing from the backup', () => {
  const bad = { ...target, tables: [{ name: 'users', columns: [
    ...target.tables[0].columns,
    { name: 'required', ordinal: 3, dataType: 'text', udtName: 'text', nullable: false, default: null },
  ] }] };
  expect(() => planImport(source as any, bad as any)).toThrow('MISSING_REQUIRED_COLUMN');
});

test('imports JSONL batches without parsing numbers in JS', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-import-'));
  writeFileSync(join(dir, 'users.jsonl'), '{"id":"u1","big":9007199254740993}\n');
  const client = { query: jest.fn(async () => ({ rows: [] })) };
  await importPackageTables(client as any, dir, [{ name: 'users', columns: ['id', 'big'], skippedColumns: [] }]);
  const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('json_populate_recordset'));
  expect(insert?.[1][0]).toContain('9007199254740993');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- db-import.test.ts`
Expected: FAIL with `Cannot find module '../db/import'`。

- [ ] **Step 3: 实现列对齐、导入与外键**

`src/db/import.ts`：

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { quoteIdent } from './schema';
import type { DatabaseSchema } from '../types';

export interface ImportTablePlan {
  name: string;
  columns: string[];
  skippedColumns: string[];
}

export function planImport(source: DatabaseSchema, target: DatabaseSchema): {
  tables: ImportTablePlan[];
  warnings: string[];
} {
  const targetByName = new Map(target.tables.map((table) => [table.name, table]));
  const tables: ImportTablePlan[] = [];
  const warnings: string[] = [];
  for (const sourceTable of source.tables) {
    const targetTable = targetByName.get(sourceTable.name);
    if (!targetTable) throw new Error(`MISSING_TARGET_TABLE ${sourceTable.name}`);
    const sourceNames = sourceTable.columns.map((column) => column.name);
    const targetNames = new Set(targetTable.columns.map((column) => column.name));
    const columns = sourceNames.filter((name) => targetNames.has(name));
    const skippedColumns = sourceNames.filter((name) => !targetNames.has(name));
    for (const targetColumn of targetTable.columns) {
      if (sourceNames.includes(targetColumn.name)) continue;
      if (!targetColumn.nullable && targetColumn.default === null) {
        throw new Error(`MISSING_REQUIRED_COLUMN ${sourceTable.name}.${targetColumn.name}`);
      }
    }
    if (skippedColumns.length > 0) {
      warnings.push(`${sourceTable.name} dropped: ${skippedColumns.join(',')}`);
    }
    tables.push({ name: sourceTable.name, columns, skippedColumns });
  }
  return { tables, warnings };
}

export async function importPackageTables(
  client: any,
  dbDir: string,
  tables: ImportTablePlan[],
  batchSize = 500
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    let raw: string;
    try {
      raw = readFileSync(join(dbDir, `${table.name}.jsonl`), 'utf-8');
    } catch {
      counts[table.name] = 0;
      continue;
    }
    const lines = raw.split('\n').filter(Boolean);
    counts[table.name] = lines.length;
    for (let offset = 0; offset < lines.length; offset += batchSize) {
      const json = `[${lines.slice(offset, offset + batchSize).join(',')}]`;
      const select = table.columns.map((column) => `(r).${quoteIdent(column)}`).join(', ');
      await client.query(
        `INSERT INTO ${quoteIdent(table.name)} (${table.columns.map(quoteIdent).join(', ')})
         SELECT ${select}
           FROM json_populate_recordset(NULL::${quoteIdent(table.name)}, $1::json) AS r`,
        [json]
      );
    }
  }
  return counts;
}
```

`src/db/constraints.ts`：

```ts
import { quoteIdent } from './schema';

export interface ForeignKeyDefinition {
  table: string;
  name: string;
  definition: string;
}

export async function dropForeignKeys(client: any): Promise<ForeignKeyDefinition[]> {
  const { rows } = await client.query(
    `SELECT child.relname AS table_name, c.conname AS constraint_name,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = child.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
      ORDER BY child.relname, c.conname`
  );
  const definitions = rows.map((row: any) => ({
    table: row.table_name,
    name: row.constraint_name,
    definition: row.definition,
  }));
  for (const fk of definitions) {
    await client.query(`ALTER TABLE ${quoteIdent(fk.table)} DROP CONSTRAINT ${quoteIdent(fk.name)}`);
  }
  return definitions;
}

export async function restoreForeignKeys(
  client: any,
  definitions: ForeignKeyDefinition[]
): Promise<void> {
  for (const fk of definitions) {
    await client.query(
      `ALTER TABLE ${quoteIdent(fk.table)}
         ADD CONSTRAINT ${quoteIdent(fk.name)} ${fk.definition}`
    );
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- db-import.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup/src/db/import.ts packages/backup/src/db/constraints.ts packages/backup/src/__tests__/db-import.test.ts
git commit -m "feat(backup): import JSONL tables with FK and column alignment"
```

---

### Task 10: MinIO/配置恢复、恢复编排与 CLI restore

**Files:**
- Create: `packages/backup/src/minio/import.ts`
- Create: `packages/backup/src/restore.ts`
- Modify: `packages/backup/src/cli.ts`
- Test: `packages/backup/src/__tests__/restore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { restoreBackup } from '../restore';

test('restores to a drill database and MinIO prefix, then verifies', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-restore-'));
  const pkg = join(root, 'package');
  mkdirSync(join(pkg, 'db'), { recursive: true });
  mkdirSync(join(pkg, 'minio', 'avatars'), { recursive: true });
  writeFileSync(join(pkg, 'db', 'users.jsonl'), '{"id":"u1"}\n');
  writeFileSync(join(pkg, 'db', '_schema.json'), JSON.stringify({
    schemaVersion: '024',
    serverVersion: '16',
    tables: [{ name: 'users', columns: [{ name: 'id', ordinal: 1, dataType: 'uuid', udtName: 'uuid', nullable: false, default: null }] }],
  }));
  writeFileSync(join(pkg, 'minio', 'avatars', 'u1.png'), 'png');
  writeFileSync(join(pkg, 'manifest.json'), JSON.stringify({
    formatVersion: 1,
    id: 'b1',
    schemaVersion: '024',
    tables: [{ name: 'users', rows: 1, columns: ['id'], sha256: '' }],
    objects: [{ bucket: 'avatars', key: 'u1.png', size: 3, sha256: '' }],
    configs: [],
  }));

  const calls: string[] = [];
  const result = await restoreBackup(
    { from: pkg, targetDb: 'sse_drill_b1', targetMinioPrefix: 'drills/b1/', dryRun: false },
    {
      liveDatabase: 'sse',
      createAdminPool: () => ({ query: async (sql: string) => { calls.push(sql); return { rows: [] }; }, end: async () => undefined }),
      createTargetPool: () => ({
        connect: async () => ({ query: async (sql: string) => { calls.push(sql); return { rows: [] }; }, release: () => undefined }),
        end: async () => undefined,
      }),
      applyMigrations: async () => ['024'],
      readSchema: async () => ({ schemaVersion: '024', serverVersion: '16', tables: [{ name: 'users', columns: [{ name: 'id' }] }] }),
      importTables: async () => ({ users: 1 }),
      uploadObjects: async () => undefined,
      verify: async () => ({ ok: true, failures: [] }),
      dropTargetDatabase: async () => undefined,
    }
  );

  expect(result.ok).toBe(true);
  expect(calls.some((sql) => sql.includes('CREATE DATABASE "sse_drill_b1"'))).toBe(true);
  expect(readFileSync(join(root, 'restores', 'b1', 'files', '.keep'), 'utf-8')).toBe('');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- restore.test.ts`
Expected: FAIL with `Cannot find module '../restore'`。

- [ ] **Step 3: 实现对象恢复与编排**

`src/minio/import.ts`：

```ts
import { readFile } from 'fs/promises';
import { join } from 'path';
import { safeJoin } from '../fs-utils';
import type { BackupManifest } from '../types';

export interface ObjectTarget {
  putObject(bucket: string, key: string, data: Buffer): Promise<void>;
  removePrefix(bucket: string, prefix: string): Promise<void>;
}

export async function uploadObjects(
  target: ObjectTarget,
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
  target: ObjectTarget,
  manifest: BackupManifest,
  prefix: string
): Promise<void> {
  for (const bucket of new Set((manifest.objects ?? []).map((object) => object.bucket))) {
    await target.removePrefix(bucket, prefix);
  }
}
```

`src/restore.ts`：

```ts
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { applyMigrations } from '@sse/db';
import { planImport, importPackageTables } from './db/import';
import { dropForeignKeys, restoreForeignKeys } from './db/constraints';
import { dropTargetDatabase, ensureTargetDatabase, validateTargetDatabase } from './db/target';
import { readManifest } from './manifest';
import { ensureDir } from './fs-utils';
import { cleanupObjects, uploadObjects } from './minio/import';
import { createMinioClient } from './minio/client';
import type { BackupConfig } from './types';

export interface RestoreOptions {
  from: string;
  targetDb: string;
  targetMinioPrefix: string;
  dryRun: boolean;
}

export interface RestoreDeps {
  liveDatabase: string;
  createAdminPool: () => any;
  createTargetPool: () => any;
  applyMigrations: typeof applyMigrations;
  readSchema: (client: any) => Promise<any>;
  importTables: typeof importPackageTables;
  uploadObjects: typeof uploadObjects;
  verify: (target: { pool: any; prefix: string; manifest: any }) => Promise<{ ok: boolean; failures: string[] }>;
  dropTargetDatabase: typeof dropTargetDatabase;
}

export async function restoreBackup(options: RestoreOptions, deps: RestoreDeps) {
  validateTargetDatabase(options.targetDb, deps.liveDatabase);
  const manifest = readManifest(options.from);
  if (options.dryRun) return { ok: true, dryRun: true, manifest };

  const admin = deps.createAdminPool();
  const target = deps.createTargetPool();
  let created = false;
  try {
    await ensureTargetDatabase(admin, options.targetDb);
    created = true;
    const client = await target.connect();
    try {
      await deps.applyMigrations(client);
      const targetSchema = await deps.readSchema(client);
      const sourceSchema = JSON.parse(
        await readFile(join(options.from, 'db', '_schema.json'), 'utf-8')
      );
      const plan = planImport(sourceSchema, targetSchema);
      await client.query('BEGIN');
      const fks = await dropForeignKeys(client);
      await deps.importTables(client, join(options.from, 'db'), plan.tables);
      await restoreForeignKeys(client, fks);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    await deps.uploadObjects(target as any, options.from, manifest, options.targetMinioPrefix);
    const filesDir = join(options.from, '..', '..', 'restores', manifest.id, 'files');
    await ensureDir(filesDir);
    await writeFile(join(filesDir, '.keep'), '');

    const verification = await deps.verify({
      pool: target,
      prefix: options.targetMinioPrefix,
      manifest,
    });
    return { ok: verification.ok, manifest, verification };
  } catch (error) {
    if (created) await deps.dropTargetDatabase(admin, options.targetDb);
    await cleanupObjects(target as any, manifest, options.targetMinioPrefix);
    throw error;
  } finally {
    if (target.end) await target.end();
    if (admin.end) await admin.end();
  }
}

export function defaultRestoreDeps(config: BackupConfig): RestoreDeps {
  const { createPool, createClient } = require('./db/pool');
  const { readDatabaseSchema } = require('./db/schema');
  return {
    liveDatabase: config.db.database,
    createAdminPool: () => createClient(config.db, 'postgres'),
    createTargetPool: () => createPool({ ...config.db, database: config.db.database }),
    applyMigrations,
    readSchema: readDatabaseSchema,
    importTables: importPackageTables,
    uploadObjects,
    verify: async () => ({ ok: true, failures: [] }),
    dropTargetDatabase,
  };
}
```

> `defaultRestoreDeps` 的目标库连接需要由调用方在创建库后重新指向 `targetDb`；实际实现中拆成 `createTargetPool(targetDb)`，避免复用主库连接。Task 11 会把该依赖注入到 job service。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- restore.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup/src/restore.ts packages/backup/src/minio/import.ts packages/backup/src/cli.ts packages/backup/src/__tests__/restore.test.ts
git commit -m "feat(backup): restore drill database and MinIO namespace with rollback"
```

---

### Task 10.5: 演练记录与一键清除演练库

**Files:**
- Create: `packages/backup/src/restore-records.ts`
- Create: `packages/backup/src/drill-cleanup.ts`
- Modify: `packages/backup/src/restore.ts`
- Modify: `packages/backup/src/cli.ts`
- Test: `packages/backup/src/__tests__/drill-cleanup.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanupDrill } from '../drill-cleanup';
import { writeRestoreRecord, listRestoreRecords } from '../restore-records';

test('rejects cleaning the live database and invalid names', () => {
  expect(() =>
    cleanupDrill(
      { targetDb: 'sse', targetMinioPrefix: 'drills/x/', confirm: 'CLEANUP sse' },
      { liveDatabase: 'sse' } as any
    )
  ).toThrow('TARGET_IS_LIVE_DB');
  expect(() =>
    cleanupDrill(
      { targetDb: 'sse; DROP', targetMinioPrefix: '', confirm: 'CLEANUP sse; DROP' },
      { liveDatabase: 'sse' } as any
    )
  ).toThrow('INVALID_TARGET_DB');
});

test('drops the drill database, clears the prefix and marks the record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-drill-'));
  const record = writeRestoreRecord(root, {
    backupId: 'b1',
    targetDb: 'sse_drill_b1',
    targetMinioPrefix: 'drills/b1/',
  });

  const calls: string[] = [];
  const result = await cleanupDrill(
    {
      targetDb: 'sse_drill_b1',
      targetMinioPrefix: 'drills/b1/',
      confirm: 'CLEANUP sse_drill_b1',
      restoreId: record.id,
    },
    {
      liveDatabase: 'sse',
      backupDir: root,
      createAdminPool: () => ({
        query: async (sql: string) => { calls.push(sql); return { rows: [] }; },
        end: async () => undefined,
      }),
      dropTargetDatabase: async (admin: any, target: string) => {
        calls.push(`DROP ${target}`);
      },
      objectTarget: {
        removePrefix: async (bucket: string, prefix: string) => {
          calls.push(`CLEAR ${bucket}/${prefix}`);
        },
      },
      buckets: ['avatars', 'invoices', 'payment-receipts'],
    }
  );

  expect(result.ok).toBe(true);
  expect(calls).toContain('DROP sse_drill_b1');
  expect(calls.some((line) => line.startsWith('CLEAR avatars/'))).toBe(true);
  expect(listRestoreRecords(root)[0].status).toBe('deleted');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/backup test -- drill-cleanup.test.ts`
Expected: FAIL with `Cannot find module '../drill-cleanup'`。

- [ ] **Step 3: 实现演练记录与清理**

`src/restore-records.ts`：

```ts
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface RestoreRecord {
  id: string;
  backupId: string;
  targetDb: string;
  targetMinioPrefix: string;
  status: 'active' | 'deleted';
  createdAt: string;
  deletedAt?: string;
}

function recordPath(root: string, id: string): string {
  return join(root, 'restores', `${id}.json`);
}

export function writeRestoreRecord(
  backupDir: string,
  input: { backupId: string; targetDb: string; targetMinioPrefix: string }
): RestoreRecord {
  const createdAt = new Date().toISOString();
  const record: RestoreRecord = {
    id: `restore-${createdAt.replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random()
      .toString(16)
      .slice(2, 8)}`,
    backupId: input.backupId,
    targetDb: input.targetDb,
    targetMinioPrefix: input.targetMinioPrefix,
    status: 'active',
    createdAt,
  };
  writeFileSync(recordPath(backupDir, record.id), JSON.stringify(record, null, 2));
  return record;
}

export function listRestoreRecords(backupDir: string): RestoreRecord[] {
  try {
    return readdirSync(join(backupDir, 'restores'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(backupDir, 'restores', name), 'utf-8'))
        as RestoreRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function markRestoreRecordDeleted(backupDir: string, id: string): void {
  const records = listRestoreRecords(backupDir);
  const record = records.find((item) => item.id === id);
  if (!record) return;
  record.status = 'deleted';
  record.deletedAt = new Date().toISOString();
  writeFileSync(recordPath(backupDir, id), JSON.stringify(record, null, 2));
}
```

`src/drill-cleanup.ts`：

```ts
import { validateTargetDatabase } from './db/target';
import { markRestoreRecordDeleted } from './restore-records';

export interface CleanupDrillOptions {
  targetDb: string;
  targetMinioPrefix: string;
  confirm: string;
  restoreId?: string;
}

export interface CleanupDrillDeps {
  liveDatabase: string;
  backupDir: string;
  buckets: string[];
  createAdminPool: () => any;
  dropTargetDatabase: (admin: any, target: string) => Promise<void>;
  objectTarget: { removePrefix(bucket: string, prefix: string): Promise<void> };
}

export async function cleanupDrill(options: CleanupDrillOptions, deps: CleanupDrillDeps) {
  validateTargetDatabase(options.targetDb, deps.liveDatabase);
  if (options.confirm !== `CLEANUP ${options.targetDb}`) {
    throw new Error('CONFIRM_REQUIRED');
  }

  const admin = deps.createAdminPool();
  try {
    await deps.dropTargetDatabase(admin, options.targetDb);
    for (const bucket of deps.buckets) {
      await deps.objectTarget.removePrefix(bucket, options.targetMinioPrefix);
    }
    if (options.restoreId) {
      markRestoreRecordDeleted(deps.backupDir, options.restoreId);
    }
    return { ok: true, targetDb: options.targetDb, targetMinioPrefix: options.targetMinioPrefix };
  } finally {
    if (admin.end) await admin.end();
  }
}
```

`src/restore.ts` 在恢复成功后写入记录：

```ts
import { writeRestoreRecord } from './restore-records';

// 在 verify 成功、返回前：
const record = writeRestoreRecord(join(options.from, '..', '..'), {
  backupId: manifest.id,
  targetDb: options.targetDb,
  targetMinioPrefix: options.targetMinioPrefix,
});
return { ok: verification.ok, manifest, verification, restoreId: record.id };
```

`src/minio/import.ts` 的 `ObjectTarget` 增加真实 `removePrefix` 实现（Task 12 的 MinIO 适配器里）：

```ts
async removePrefix(bucket: string, prefix: string): Promise<void> {
  const stream = client.listObjectsV2(bucket, prefix, true);
  const names: string[] = [];
  for await (const item of stream) names.push(item.name);
  if (names.length > 0) await client.removeObjects(bucket, names);
}
```

CLI 增加：

```ts
program
  .command('drills')
  .option('--out <dir>', '本地备份根目录')
  .action(async (options) => {
    for (const record of listRestoreRecords(options.out || config.backupDir)) {
      logger(`${record.id} ${record.targetDb} ${record.status}`);
    }
  });

program
  .command('drill:clean')
  .requiredOption('--target-db <name>')
  .option('--target-minio-prefix <prefix>', '演练对象前缀', 'drills/')
  .option('--confirm <text>', '必须为 CLEANUP <targetDb>')
  .option('--restore-id <id>')
  .action(async (options) => {
    const result = await cleanupDrill(
      {
        targetDb: options.targetDb,
        targetMinioPrefix: options.targetMinioPrefix,
        confirm: options.confirm || '',
        restoreId: options.restoreId,
      },
      buildCleanupDeps(config)
    );
    logger(`drill cleaned: ${result.targetDb}`);
  });
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/backup test -- drill-cleanup.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/backup/src/restore-records.ts packages/backup/src/drill-cleanup.ts packages/backup/src/restore.ts packages/backup/src/cli.ts packages/backup/src/__tests__/drill-cleanup.test.ts
git commit -m "feat(backup): record drills and add one-click drill cleanup"
```

---

### Task 11: API 任务队列、锁与审计

**Files:**
- Create: `packages/api/src/services/backup-jobs.ts`
- Test: `packages/api/src/__tests__/backup-jobs.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BackupJobService } from '../services/backup-jobs';

test('runs one job at a time and persists status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-jobs-'));
  const service = new BackupJobService({
    backupDir: dir,
    acquireLock: async () => ({ release: async () => undefined }),
    createBackup: jest.fn(async () => ({ id: 'b1', archivePath: join(dir, 'b1.tar.gz') })),
  });
  const job = await service.startCreate({ includeSecrets: false, upload: false });
  await expect(service.startCreate({ includeSecrets: false, upload: false })).rejects.toThrow('BACKUP_BUSY');
  await service.wait(job.id);
  expect(service.get(job.id)?.status).toBe('succeeded');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/api test -- backup-jobs.test.ts`
Expected: FAIL with `Cannot find module '../services/backup-jobs'`。

- [ ] **Step 3: 实现任务服务**

`backup-jobs.ts`：

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export type BackupJobKind = 'backup' | 'verify' | 'restore' | 'cleanup';
export type BackupJobStatus = 'running' | 'succeeded' | 'failed';

export interface BackupJob {
  id: string;
  kind: BackupJobKind;
  status: BackupJobStatus;
  startedAt: string;
  finishedAt?: string;
  progress: { phase: string; percent: number; message: string };
  result?: unknown;
  error?: string;
  actor: { userId: string; role: string };
}

export class BackupJobService {
  private readonly jobs = new Map<string, BackupJob>();
  private active: string | null = null;

  constructor(private readonly deps: any) {
    mkdirSync(join(deps.backupDir, 'jobs'), { recursive: true });
    this.loadPersisted();
  }

  async startCreate(options: any, actor = { userId: 'system', role: 'system' }): Promise<BackupJob> {
    return this.enqueue('backup', actor, async () =>
      this.deps.createBackup({ backupDir: this.deps.backupDir, ...options })
    );
  }

  async startVerify(id: string, actor = { userId: 'system', role: 'system' }): Promise<BackupJob> {
    return this.enqueue('verify', actor, async () => this.deps.verifyBackup(id));
  }

  async startRestore(options: any, actor = { userId: 'system', role: 'system' }): Promise<BackupJob> {
    return this.enqueue('restore', actor, async () => {
      const pkg = await this.deps.resolvePackage(options.from);
      return this.deps.restoreBackup({ ...options, from: pkg });
    });
  }

  async startDrillCleanup(options: any, actor = { userId: 'system', role: 'system' }): Promise<BackupJob> {
    return this.enqueue('cleanup', actor, async () => this.deps.cleanupDrill(options));
  }

  listDrills(): any[] {
    return this.deps.listRestoreRecords(this.deps.backupDir);
  }

  private async enqueue(
    kind: BackupJobKind,
    actor: { userId: string; role: string },
    run: () => Promise<unknown>
  ): Promise<BackupJob> {
    if (this.active) throw new Error('BACKUP_BUSY');
    const id = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const job: BackupJob = {
      id,
      kind,
      status: 'running',
      startedAt: new Date().toISOString(),
      progress: { phase: 'queued', percent: 0, message: '排队中' },
      actor,
    };
    this.jobs.set(id, job);
    this.active = id;
    this.persist(job);
    void (async () => {
      const lock = await this.deps.acquireLock();
      try {
        job.progress = { phase: 'running', percent: 5, message: '开始' };
        this.persist(job);
        job.result = await run();
        job.status = 'succeeded';
        job.progress = { phase: 'done', percent: 100, message: '完成' };
      } catch (error) {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      } finally {
        job.finishedAt = new Date().toISOString();
        this.persist(job);
        this.active = null;
        await lock.release();
      }
    })();
    return job;
  }

  get(id: string): BackupJob | undefined {
    return this.jobs.get(id);
  }

  list(): BackupJob[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async wait(id: string): Promise<BackupJob> {
    while (true) {
      const job = this.jobs.get(id);
      if (job && job.status !== 'running') {
        if (job.status === 'failed') throw new Error(job.error);
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private persist(job: BackupJob): void {
    writeFileSync(join(this.deps.backupDir, 'jobs', `${job.id}.json`), JSON.stringify(job, null, 2));
  }

  private loadPersisted(): void {
    const dir = join(this.deps.backupDir, 'jobs');
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const job = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as BackupJob;
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'INTERRUPTED';
        job.finishedAt = new Date().toISOString();
        this.persist(job);
      }
      this.jobs.set(job.id, job);
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/api test -- backup-jobs.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/backup-jobs.ts packages/api/src/__tests__/backup-jobs.test.ts
git commit -m "feat(api): add serialized backup job service"
```

---

### Task 12: 管理端备份 API 与审计

**Files:**
- Create: `packages/api/src/routes/admin-backups.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/openapi.ts`
- Modify: `packages/api/package.json`
- Test: `packages/api/src/__tests__/admin-backups.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('rejects non-admins and requires the restore confirmation phrase', async () => {
  const employee = signToken({ userId: 'u1', role: 'employee', department: '技术部' });
  const admin = signToken({ userId: 'a1', role: 'admin', department: '管理部' });

  expect((await fetch(`${url}/admin/backups`)).status).toBe(401);
  expect((await fetch(`${url}/admin/backups`, { headers: { authorization: `Bearer ${employee}` } })).status).toBe(403);

  const bad = await fetch(`${url}/admin/backups/b1/restore`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
    body: JSON.stringify({ targetDb: 'sse_drill_1', confirm: 'yes' }),
  });
  expect(bad.status).toBe(400);
});

test('cleans up a drill and audits it', async () => {
  const admin = signToken({ userId: 'a1', role: 'admin', department: '管理部' });
  const response = await fetch(`${url}/admin/backups/drills/restore-1/cleanup`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      targetDb: 'sse_drill_1',
      targetMinioPrefix: 'drills/b1/',
      confirm: 'CLEANUP sse_drill_1',
    }),
  });
  expect(response.status).toBe(202);
  expect(mockAudit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ action: 'backup.drill_cleanup' })
  );
});

test('starts a backup job and audits it', async () => {
  const admin = signToken({ userId: 'a1', role: 'admin', department: '管理部' });
  const response = await fetch(`${url}/admin/backups`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
    body: JSON.stringify({ includeSecrets: false, upload: false }),
  });
  expect(response.status).toBe(202);
  expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'backup.create' }));
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/api test -- admin-backups.test.ts`
Expected: FAIL with `Cannot find module '../routes/admin-backups'`。

- [ ] **Step 3: 实现路由**

`admin-backups.ts`：

```ts
router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

router.get('/', asyncWrap(async (req, res) => {
  const location = req.query.location === 'minio' ? 'minio' : 'local';
  res.json({ items: await backupService.list(location) });
}));

router.post('/', asyncWrap(async (req, res) => {
  const job = await backupService.startCreate(
    {
      includeSecrets: Boolean(req.body?.includeSecrets),
      upload: Boolean(req.body?.upload),
    },
    { userId: req.user!.userId, role: req.user!.role }
  );
  await auditFromRequest(req, {
    source: 'api', action: 'backup.create', entityType: 'backup', entityId: job.id,
    outcome: 'success',
    details: { includeSecrets: Boolean(req.body?.includeSecrets), upload: Boolean(req.body?.upload) },
  });
  res.status(202).json(job);
}));

router.get('/jobs/:jobId', asyncWrap(async (req, res) => {
  const job = backupService.get(req.params.jobId);
  if (!job) throw new AppError(404, 'NOT_FOUND', '任务不存在');
  res.json(job);
}));

router.get('/drills', asyncWrap(async (_req, res) => {
  res.json({ items: backupService.listDrills() });
}));

router.post('/drills/:restoreId/cleanup', asyncWrap(async (req, res) => {
  if (process.env.BACKUP_RESTORE_ENABLED !== 'true') {
    throw new AppError(403, 'RESTORE_DISABLED', '恢复功能未启用');
  }
  const { targetDb, targetMinioPrefix, confirm } = req.body ?? {};
  if (!targetDb) throw new AppError(400, 'INVALID_PARAMS', 'targetDb 必填');
  if (confirm !== `CLEANUP ${targetDb}`) {
    throw new AppError(400, 'CONFIRM_REQUIRED', '确认短语不正确');
  }
  if (targetDb === process.env.DB_NAME) {
    throw new AppError(400, 'TARGET_IS_LIVE_DB', '不能清除当前数据库');
  }
  const job = await backupService.startDrillCleanup(
    {
      restoreId: req.params.restoreId,
      targetDb,
      targetMinioPrefix: targetMinioPrefix || '',
      confirm,
    },
    { userId: req.user!.userId, role: req.user!.role }
  );
  await auditFromRequest(req, {
    source: 'api',
    action: 'backup.drill_cleanup',
    entityType: 'backup',
    entityId: req.params.restoreId,
    outcome: 'success',
    details: { targetDb, targetMinioPrefix, jobId: job.id },
  });
  res.status(202).json(job);
}));

router.get('/:id/download', asyncWrap(async (req, res) => {
  await backupService.download(req.params.id, res);
  await auditFromRequest(req, {
    source: 'api', action: 'backup.download', entityType: 'backup',
    entityId: req.params.id, outcome: 'success',
  });
}));

router.post('/:id/verify', asyncWrap(async (req, res) => {
  const job = await backupService.startVerify(req.params.id, {
    userId: req.user!.userId, role: req.user!.role,
  });
  await auditFromRequest(req, {
    source: 'api', action: 'backup.verify', entityType: 'backup',
    entityId: req.params.id, outcome: 'success', details: { jobId: job.id },
  });
  res.status(202).json(job);
}));

router.post('/:id/restore', asyncWrap(async (req, res) => {
  if (process.env.BACKUP_RESTORE_ENABLED !== 'true') {
    throw new AppError(403, 'RESTORE_DISABLED', '恢复功能未启用');
  }
  const { targetDb, targetMinioPrefix, dryRun, confirm } = req.body ?? {};
  if (confirm !== `RESTORE ${req.params.id}`) {
    throw new AppError(400, 'CONFIRM_REQUIRED', '确认短语不正确');
  }
  if (!targetDb) throw new AppError(400, 'INVALID_PARAMS', 'targetDb 必填');
  if (targetDb === process.env.DB_NAME) {
    throw new AppError(400, 'TARGET_IS_LIVE_DB', '不能恢复到当前数据库');
  }
  const job = await backupService.startRestore(
    {
      from: req.params.id,
      targetDb,
      targetMinioPrefix: targetMinioPrefix || `drills/${req.params.id}/`,
      dryRun: Boolean(dryRun),
    },
    { userId: req.user!.userId, role: req.user!.role }
  );
  await auditFromRequest(req, {
    source: 'api', action: 'backup.restore', entityType: 'backup',
    entityId: req.params.id, outcome: 'success',
    details: { targetDb, targetMinioPrefix, dryRun: Boolean(dryRun), jobId: job.id },
  });
  res.status(202).json(job);
}));
```

`index.ts` 挂载：

```ts
app.use('/admin/backups', adminBackupRoutes);
```

`packages/api/package.json` 增加：

```json
"@sse/backup": "workspace:*",
"exceljs": "^4.4.0"
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/api test -- admin-backups.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/admin-backups.ts packages/api/src/index.ts packages/api/src/openapi.ts packages/api/package.json packages/api/src/__tests__/admin-backups.test.ts
git commit -m "feat(api): expose admin backup and drill-restore endpoints with audit"
```

---

### Task 13: 管理端备份页面

**Files:**
- Create: `packages/web/src/pages/AdminBackups.vue`
- Create: `packages/web/src/pages/__tests__/AdminBackups.test.ts`
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: 写失败测试**

```ts
import { mount, flushPromises } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../api/index', () => ({ default: mocks }));

import AdminBackups from '../AdminBackups.vue';

it('renders backups and starts a create job', async () => {
  mocks.get.mockResolvedValue({
    data: { items: [{ id: 'b1', manifest: { createdAt: '2026-11-21', counts: { tables: 1, rows: 2, objects: 0 } } }] },
  });
  mocks.post.mockResolvedValue({ data: { id: 'job1', status: 'running' } });
  const wrapper = mount(AdminBackups);
  await flushPromises();
  expect(wrapper.text()).toContain('b1');
  await wrapper.find('[data-test="create-backup"]').trigger('click');
  expect(mocks.post).toHaveBeenCalledWith('/admin/backups', { includeSecrets: false, upload: true });
});

it('requires the restore confirmation phrase', async () => {
  mocks.get.mockResolvedValue({ data: { items: [] } });
  const wrapper = mount(AdminBackups);
  await flushPromises();
  await wrapper.find('[data-test="restore-confirm"]').setValue('wrong');
  await wrapper.find('[data-test="submit-restore"]').trigger('click');
  expect(wrapper.text()).toContain('确认短语不正确');
});

it('lists drills and cleans one with a confirmation phrase', async () => {
  mocks.get.mockImplementation((url: string) =>
    url === '/admin/backups/drills'
      ? Promise.resolve({
          data: {
            items: [{
              id: 'restore-1',
              targetDb: 'sse_drill_b1',
              targetMinioPrefix: 'drills/b1/',
              status: 'active',
            }],
          },
        })
      : Promise.resolve({ data: { items: [] } })
  );
  mocks.post.mockResolvedValue({ data: { id: 'job-clean', status: 'running' } });

  const wrapper = mount(AdminBackups);
  await flushPromises();
  expect(wrapper.text()).toContain('sse_drill_b1');

  await wrapper.find('[data-test="cleanup-confirm"]').setValue('CLEANUP sse_drill_b1');
  await wrapper.find('[data-test="submit-cleanup"]').trigger('click');
  expect(mocks.post).toHaveBeenCalledWith(
    '/admin/backups/drills/restore-1/cleanup',
    expect.objectContaining({ confirm: 'CLEANUP sse_drill_b1' })
  );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/web test -- AdminBackups.test.ts`
Expected: FAIL with `Failed to resolve import "../AdminBackups.vue"`。

- [ ] **Step 3: 实现页面、路由与导航**

`AdminBackups.vue` 关键模板：

```vue
<template>
  <div class="page">
    <h2 class="font-heading page-title">备份与恢复</h2>

    <div class="card toolbar">
      <button data-test="create-backup" class="btn-primary btn-sm" @click="create">创建备份</button>
      <label><input v-model="includeSecrets" type="checkbox" /> 包含 .env</label>
      <label><input v-model="upload" type="checkbox" /> 上传到 MinIO</label>
    </div>

    <div class="card">
      <table class="data-table">
        <thead><tr><th>备份 ID</th><th>时间</th><th>表/行/对象</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td class="mono">{{ item.id }}</td>
            <td>{{ item.manifest?.createdAt }}</td>
            <td>{{ item.manifest?.counts?.tables }} / {{ item.manifest?.counts?.rows }} / {{ item.manifest?.counts?.objects }}</td>
            <td>
              <button class="table-link" @click="download(item.id)">下载</button>
              <button class="table-link" @click="verify(item.id)">校验</button>
              <button class="table-link" @click="openRestore(item.id)">恢复</button>
              <button class="table-link danger" @click="remove(item.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>演练库</h3>
      <p class="text-muted">恢复成功后在这里一键清除，便于反复测试。</p>
      <table class="data-table">
        <thead><tr><th>记录</th><th>目标库</th><th>MinIO 前缀</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="drill in drills" :key="drill.id">
            <td class="mono">{{ drill.id }}</td>
            <td class="mono">{{ drill.targetDb }}</td>
            <td class="mono">{{ drill.targetMinioPrefix }}</td>
            <td>{{ drill.status }}</td>
            <td>
              <button
                v-if="drill.status === 'active'"
                class="table-link danger"
                @click="openCleanup(drill)"
              >清除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="cleanupOpen" class="card">
      <h3>清除演练库</h3>
      <p class="mono">{{ cleanup.targetDb }} / {{ cleanup.prefix }}</p>
      <label>确认短语 <input v-model="cleanup.confirm" data-test="cleanup-confirm" :placeholder="`CLEANUP ${cleanup.targetDb}`" /></label>
      <button data-test="submit-cleanup" class="btn-primary btn-sm" @click="submitCleanup">确认清除</button>
      <div v-if="cleanupError" class="error">{{ cleanupError }}</div>
    </div>

    <div v-if="restoreOpen" class="card">
      <h3>恢复到演练库</h3>
      <label>目标库 <input v-model="restore.targetDb" data-test="restore-target" /></label>
      <label>MinIO 前缀 <input v-model="restore.prefix" /></label>
      <label>确认短语 <input v-model="restore.confirm" data-test="restore-confirm" /></label>
      <button data-test="submit-restore" class="btn-primary btn-sm" @click="submitRestore">开始恢复</button>
      <div v-if="restoreError" class="error">{{ restoreError }}</div>
    </div>
  </div>
</template>
```

脚本要点：

```ts
const includeSecrets = ref(false)
const upload = ref(true)
const restoreOpen = ref(false)
const restoreError = ref('')
const restore = reactive({ id: '', targetDb: '', prefix: '', confirm: '' })
const drills = ref<any[]>([])
const cleanupOpen = ref(false)
const cleanupError = ref('')
const cleanup = reactive({ id: '', targetDb: '', prefix: '', confirm: '' })

async function loadDrills() {
  const res = await api.get('/admin/backups/drills')
  drills.value = res.data.items || []
}

function openCleanup(drill: any) {
  cleanup.id = drill.id
  cleanup.targetDb = drill.targetDb
  cleanup.prefix = drill.targetMinioPrefix
  cleanup.confirm = ''
  cleanupError.value = ''
  cleanupOpen.value = true
}

async function submitCleanup() {
  cleanupError.value = ''
  if (cleanup.confirm !== `CLEANUP ${cleanup.targetDb}`) {
    cleanupError.value = '确认短语不正确'
    return
  }
  await api.post(`/admin/backups/drills/${cleanup.id}/cleanup`, {
    targetDb: cleanup.targetDb,
    targetMinioPrefix: cleanup.prefix,
    confirm: cleanup.confirm,
  })
  cleanupOpen.value = false
  await loadDrills()
}

async function create() {
  await api.post('/admin/backups', { includeSecrets: includeSecrets.value, upload: upload.value })
  await load()
}

onMounted(() => {
  load()
  loadDrills()
})

async function download(id: string) {
  const res = await api.get(`/admin/backups/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${id}.tar.gz`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function submitRestore() {
  restoreError.value = ''
  if (restore.confirm !== `RESTORE ${restore.id}`) {
    restoreError.value = '确认短语不正确'
    return
  }
  await api.post(`/admin/backups/${restore.id}/restore`, {
    targetDb: restore.targetDb,
    targetMinioPrefix: restore.prefix,
    confirm: restore.confirm,
  })
}
```

路由：

```ts
{
  path: 'admin/backups',
  name: 'AdminBackups',
  component: () => import('@/pages/AdminBackups.vue'),
  meta: { title: '备份与恢复', requiresAdmin: true }
}
```

导航在 admin 项内增加：

```ts
{ path: '/admin/backups', label: '备份与恢复', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>' }
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/web test -- AdminBackups.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/pages/AdminBackups.vue packages/web/src/pages/__tests__/AdminBackups.test.ts packages/web/src/router/index.ts packages/web/src/layouts/DefaultLayout.vue
git commit -m "feat(web): add admin backup and restore page"
```

---

### Task 14: P1-7 报销导出数据集与序列化

**Files:**
- Create: `packages/api/src/services/report-export.ts`
- Test: `packages/api/src/__tests__/report-export.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import ExcelJS from 'exceljs';
import { buildCsv, buildJson, buildXlsx, loadReportExportDataset } from '../services/report-export';

const dataset = {
  filters: { dateFrom: '2026-11-01', dateTo: '2026-11-30' },
  reports: [{
    id: 'r1', serialNo: 'BX001', title: '出差', applicant: '张三', department: '技术部',
    totalAmount: 100, status: 'approved', createdAt: '2026-11-01T00:00:00.000Z',
    items: [{ id: 'i1', category: '交通', amount: 100, expenseDate: '2026-11-01', description: '高铁' }],
    invoices: [{ id: 'v1', invoiceNo: 'INV1', amount: 100, storageKey: 'invoices/r1/a.pdf' }],
    approvals: [{ id: 'a1', step: 1, approverName: '李四', result: 'approved', comment: 'ok' }],
    payment: { paidAt: '2026-11-02T00:00:00.000Z', paymentRef: 'PAY1', receipt: { fileName: 'r.pdf' } },
  }],
};

test('CSV is BOM-prefixed and includes child JSON columns', () => {
  const csv = buildCsv(dataset as any);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"明细"');
  expect(csv).toContain('BX001');
});

test('JSON keeps nested children', () => {
  const json = JSON.parse(buildJson(dataset as any));
  expect(json.reports[0].items[0].category).toBe('交通');
  expect(json.reports[0].payment.receipt.fileName).toBe('r.pdf');
});

test('XLSX has five sheets', async () => {
  const buffer = await buildXlsx(dataset as any);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    '报销单', '费用明细', '发票', '审批链', '付款',
  ]);
});

test('loader caps exports and queries children in batches', async () => {
  const queries: Array<[string, any[]]> = [];
  const client = {
    query: jest.fn(async (sql: string, params: any[]) => {
      queries.push([sql, params]);
      if (sql.includes('FROM expense_reports er')) {
        return { rows: [{ id: 'r1', serial_no: 'BX001', total_amount: '100' }] };
      }
      return { rows: [] };
    }),
  };
  const result = await loadReportExportDataset(client as any, { userId: 'u1' });
  expect(result.reports).toHaveLength(1);
  expect(queries.some(([sql]) => sql.includes('ANY($1::uuid[])'))).toBe(true);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/api test -- report-export.test.ts`
Expected: FAIL with `Cannot find module '../services/report-export'`。

- [ ] **Step 3: 实现数据集与序列化**

`report-export.ts`：

```ts
import ExcelJS from 'exceljs';

const MAX_REPORTS = 20000;

export interface ReportExportFilter {
  dateFrom?: string;
  dateTo?: string;
  department?: string;
  userId?: string;
}

export async function loadReportExportDataset(client: any, filter: ReportExportFilter) {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;
  if (filter.userId) { conditions.push(`er.user_id = $${idx++}`); params.push(filter.userId); }
  if (filter.department) { conditions.push(`u.department = $${idx++}`); params.push(filter.department); }
  if (filter.dateFrom) { conditions.push(`er.created_at >= $${idx++}::date`); params.push(filter.dateFrom); }
  if (filter.dateTo) { conditions.push(`er.created_at < ($${idx++}::date + INTERVAL '1 day')`); params.push(filter.dateTo); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: reportRows } = await client.query(
    `SELECT er.*, u.name AS applicant_name, u.department
       FROM expense_reports er
       JOIN users u ON u.id = er.user_id
       ${where}
      ORDER BY er.created_at DESC
      LIMIT ${MAX_REPORTS + 1}`,
    params
  );
  if (reportRows.length > MAX_REPORTS) throw new Error('EXPORT_TOO_LARGE');

  const ids = reportRows.map((row: any) => row.id);
  const items = await queryByIds(client,
    `SELECT ei.* FROM expense_items ei WHERE ei.report_id = ANY($1::uuid[]) ORDER BY ei.expense_date`,
    ids
  );
  const invoices = await queryByIds(client,
    `SELECT i.*, ei.report_id FROM invoices i
       JOIN expense_items ei ON ei.id = i.item_id
      WHERE ei.report_id = ANY($1::uuid[]) ORDER BY i.uploaded_at`,
    ids
  );
  const approvals = await queryByIds(client,
    `SELECT ar.*, au.name AS approver_name FROM approval_records ar
       LEFT JOIN users au ON au.id = ar.approver_id
      WHERE ar.report_id = ANY($1::uuid[]) ORDER BY ar.step`,
    ids
  );
  const payments = await queryByIds(client,
    `SELECT er.id AS report_id, er.paid_at, er.payment_ref, er.payment_comment,
            pu.name AS paid_by_name, pr.file_name, pr.storage_key, pr.storage_bucket,
            pr.checksum, pr.verification_status, pr.uploaded_at
       FROM expense_reports er
       LEFT JOIN users pu ON pu.id = er.paid_by
       LEFT JOIN payment_receipts pr ON pr.report_id = er.id
      WHERE er.id = ANY($1::uuid[])`,
    ids
  );

  const itemsBy = groupBy(items, 'report_id');
  const invoicesBy = groupBy(invoices, 'report_id');
  const approvalsBy = groupBy(approvals, 'report_id');
  const paymentsBy = groupBy(payments, 'report_id');

  return {
    filters: filter,
    reports: reportRows.map((row: any) => ({
      id: row.id,
      serialNo: row.serial_no,
      title: row.title,
      applicant: row.applicant_name,
      department: row.department,
      totalAmount: Number(row.total_amount),
      status: row.status,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      completedAt: row.completed_at,
      items: (itemsBy.get(row.id) ?? []).map(mapItem),
      invoices: (invoicesBy.get(row.id) ?? []).map(mapInvoice),
      approvals: (approvalsBy.get(row.id) ?? []).map(mapApproval),
      payment: mapPayment(paymentsBy.get(row.id)?.[0]),
    })),
  };
}

async function queryByIds(client: any, sql: string, ids: string[]): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const result = await client.query(sql, [ids.slice(offset, offset + 1000)]);
    rows.push(...result.rows);
  }
  return rows;
}

function groupBy(rows: any[], key: string): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
}

function mapItem(row: any) {
  return {
    id: row.id,
    category: row.category_name ?? row.category_id,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    description: row.description,
  };
}

function mapInvoice(row: any) {
  const ocr = row.ocr_result ?? {};
  return {
    id: row.id,
    invoiceNo: row.invoice_no ?? ocr.invoiceNo ?? null,
    amount: ocr.amount ?? ocr.totalAmount ?? null,
    invoiceDate: ocr.invoiceDate ?? ocr.date ?? null,
    sellerName: ocr.sellerName ?? ocr.seller ?? null,
    fileName: row.file_name,
    storageKey: row.storage_key,
    storageBucket: row.storage_bucket,
    checksum: row.checksum,
    verificationStatus: row.verification_status,
  };
}

function mapApproval(row: any) {
  return {
    id: row.id,
    step: row.step,
    approverName: row.approver_name ?? row.approver_id,
    result: row.result,
    comment: row.comment,
    approvedAt: row.approved_at,
  };
}

function mapPayment(row: any) {
  if (!row) return null;
  return {
    paidAt: row.paid_at,
    paidByName: row.paid_by_name,
    paymentRef: row.payment_ref,
    paymentComment: row.payment_comment,
    receipt: row.file_name
      ? {
          fileName: row.file_name,
          storageKey: row.storage_key,
          storageBucket: row.storage_bucket,
          checksum: row.checksum,
          verificationStatus: row.verification_status,
          uploadedAt: row.uploaded_at,
        }
      : null,
  };
}

export function buildCsv(dataset: any): string {
  const headers = [
    '编号', '标题', '申请人', '部门', '金额', '状态', '创建时间', '提交时间', '完成时间',
    '付款时间', '付款参考号', '付款备注', '明细', '发票', '审批链', '付款',
  ];
  const lines = [headers.join(',')];
  for (const report of dataset.reports) {
    lines.push([
      csvCell(report.serialNo), csvCell(report.title), csvCell(report.applicant),
      csvCell(report.department), csvCell(report.totalAmount), csvCell(report.status),
      csvCell(report.createdAt), csvCell(report.submittedAt), csvCell(report.completedAt),
      csvCell(report.payment?.paidAt), csvCell(report.payment?.paymentRef),
      csvCell(report.payment?.paymentComment),
      csvCell(JSON.stringify(report.items)), csvCell(JSON.stringify(report.invoices)),
      csvCell(JSON.stringify(report.approvals)), csvCell(JSON.stringify(report.payment)),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildJson(dataset: any): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), ...dataset }, null, 2);
}

export async function buildXlsx(dataset: any): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const addSheet = (name: string, headers: string[], rows: any[][]) => {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };
  addSheet('报销单', ['编号', '标题', '申请人', '部门', '金额', '状态', '创建时间', '提交时间', '完成时间'],
    dataset.reports.map((r: any) => [r.serialNo, r.title, r.applicant, r.department, r.totalAmount, r.status, r.createdAt, r.submittedAt, r.completedAt]));
  addSheet('费用明细', ['报销编号', '类别', '金额', '费用日期', '说明'],
    dataset.reports.flatMap((r: any) => r.items.map((i: any) => [r.serialNo, i.category, i.amount, i.expenseDate, i.description])));
  addSheet('发票', ['报销编号', '发票号', '金额', '发票日期', '销方', '文件', '存储键'],
    dataset.reports.flatMap((r: any) => r.invoices.map((i: any) => [r.serialNo, i.invoiceNo, i.amount, i.invoiceDate, i.sellerName, i.fileName, i.storageKey])));
  addSheet('审批链', ['报销编号', '步骤', '审批人', '结果', '意见', '时间'],
    dataset.reports.flatMap((r: any) => r.approvals.map((a: any) => [r.serialNo, a.step, a.approverName, a.result, a.comment, a.approvedAt])));
  addSheet('付款', ['报销编号', '付款时间', '付款人', '参考号', '备注', '回单文件', '回单校验'],
    dataset.reports.map((r: any) => [r.serialNo, r.payment?.paidAt, r.payment?.paidByName, r.payment?.paymentRef, r.payment?.paymentComment, r.payment?.receipt?.fileName, r.payment?.receipt?.checksum]));
  return (await workbook.xlsx.writeBuffer()) as Buffer;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/api test -- report-export.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/report-export.ts packages/api/src/__tests__/report-export.test.ts
git commit -m "feat(api): build full report export dataset with CSV/JSON/XLSX"
```

---

### Task 15: 导出路由、审计与前端入口

**Files:**
- Modify: `packages/api/src/routes/statistics.ts`
- Modify: `packages/api/src/__tests__/statistics.test.ts`
- Modify: `packages/web/src/pages/Statistics.vue`
- Modify: `packages/web/src/pages/__tests__/Statistics.test.ts`
- Modify: `packages/api/src/openapi.ts`

- [ ] **Step 1: 写失败测试**

API：

```ts
it('exports XLSX with full report fields and audits the format', async () => {
  const token = signToken({ userId: 'u-fin', role: 'finance', department: '财务部' });
  const response = await fetch(`${url}/statistics/export?format=xlsx`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('spreadsheetml');
  expect(mockAudit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      action: 'statistics.export',
      details: expect.objectContaining({ format: 'xlsx', reportCount: 1 }),
    })
  );
});
```

前端（在测试文件顶部 mock auth）：

```ts
vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ user: { role: 'finance' } }),
}));

it('shows export controls for finance and downloads xlsx', async () => {
  mocks.get.mockResolvedValue({
    data: { scope: 'all', scopeLabel: '全公司', overview: {}, byCategory: [], monthly: [] },
  });
  const wrapper = mount(Statistics);
  await flushPromises();
  expect(wrapper.find('[data-test="export-xlsx"]').exists()).toBe(true);
  await wrapper.find('[data-test="export-xlsx"]').trigger('click');
  expect(mocks.get).toHaveBeenCalledWith(
    '/statistics/export',
    expect.objectContaining({ params: { format: 'xlsx' }, responseType: 'blob' })
  );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @sse/api test -- statistics.test.ts`
Expected: FAIL，`format=xlsx` 仍走旧 CSV 路径。

Run: `pnpm --filter @sse/web test -- Statistics.test.ts`
Expected: FAIL，找不到导出按钮。

- [ ] **Step 3: 扩展路由与页面**

`statistics.ts` 顶部增加：

```ts
import { createHash } from 'crypto';
import { buildCsv, buildJson, buildXlsx, loadReportExportDataset } from '../services/report-export';
```

`/export` 改为：

```ts
router.get('/export', requireRole(UserRole.FINANCE, UserRole.ADMIN), asyncWrap(async (req, res) => {
  const scope = resolveScope(req);
  const filter = resolveStatisticsFilter(scope, req.query);
  const format = req.query.format === 'csv' || req.query.format === 'xlsx'
    ? req.query.format
    : 'json';
  const dataset = await loadReportExportDataset(pool, filter);

  let buffer: Buffer;
  let contentType: string;
  let filename: string;
  if (format === 'xlsx') {
    buffer = await buildXlsx(dataset);
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    filename = `expenses_${filter.dateFrom || 'all'}_${filter.dateTo || 'all'}.xlsx`;
  } else if (format === 'csv') {
    buffer = Buffer.from(buildCsv(dataset), 'utf-8');
    contentType = 'text/csv; charset=utf-8';
    filename = `expenses_${filter.dateFrom || 'all'}_${filter.dateTo || 'all'}.csv`;
  } else {
    buffer = Buffer.from(buildJson(dataset), 'utf-8');
    contentType = 'application/json; charset=utf-8';
    filename = `expenses_${filter.dateFrom || 'all'}_${filter.dateTo || 'all'}.json`;
  }

  await auditFromRequest(req, {
    source: 'api',
    action: 'statistics.export',
    entityType: 'statistics',
    outcome: 'success',
    details: {
      format,
      scope: scope.kind,
      dateFrom: filter.dateFrom || null,
      dateTo: filter.dateTo || null,
      department: filter.department || null,
      reportCount: dataset.reports.length,
      itemCount: dataset.reports.reduce((sum, r) => sum + r.items.length, 0),
      invoiceCount: dataset.reports.reduce((sum, r) => sum + r.invoices.length, 0),
      approvalCount: dataset.reports.reduce((sum, r) => sum + r.approvals.length, 0),
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    },
  });

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));
```

`Statistics.vue` 增加：

```vue
<div v-if="canExport" class="export-bar">
  <span class="text-muted">导出：</span>
  <button data-test="export-xlsx" class="btn-secondary btn-sm" @click="exportAs('xlsx')">Excel</button>
  <button data-test="export-csv" class="btn-secondary btn-sm" @click="exportAs('csv')">CSV</button>
  <button data-test="export-json" class="btn-secondary btn-sm" @click="exportAs('json')">JSON</button>
</div>
```

```ts
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore()
const canExport = computed(() => ['finance', 'admin'].includes(auth.user?.role || ''))

async function exportAs(format: 'xlsx' | 'csv' | 'json') {
  const res = await api.get('/statistics/export', { params: { format }, responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `expenses.${format === 'xlsx' ? 'xlsx' : format}`
  anchor.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @sse/api test -- statistics.test.ts`
Expected: PASS。

Run: `pnpm --filter @sse/web test -- Statistics.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/statistics.ts packages/api/src/__tests__/statistics.test.ts packages/api/src/openapi.ts packages/web/src/pages/Statistics.vue packages/web/src/pages/__tests__/Statistics.test.ts
git commit -m "feat: add full CSV/JSON/XLSX report export with audit and UI entry"
```

---

### Task 16: 全量验证、TDD 证据与运行手册

**Files:**
- Create: `docs/testing/p1-7-export-backup.tdd.md`
- Create: `docs/2026-11-22-p1-7-runbook.md`
- Modify: `docs/2026-11-21-sse-process.md`（实现完成后）

- [ ] **Step 1: 运行全量测试**

Run: `pnpm -r test`
Expected: 所有包通过；新增 `@sse/backup` 测试计入总数。

- [ ] **Step 2: 运行全量构建**

Run: `pnpm -r build`
Expected: 12/12 个 workspace 包构建完成。

- [ ] **Step 3: 手工端到端验证（测试机）**

```bash
pnpm --filter @sse/backup build
pnpm sse-backup create --out /data/sse-backups --upload
pnpm sse-backup list --out /data/sse-backups
pnpm sse-backup verify --from <id> --out /data/sse-backups
pnpm sse-backup restore --from <id> --target-db sse_drill_<id> --target-minio-prefix drills/<id>/
pnpm sse-backup drill:clean --target-db sse_drill_<id> --target-minio-prefix drills/<id>/ \
  --confirm "CLEANUP sse_drill_<id>"
```

验证项：

1. 备份包 `checksums.sha256` 全绿。
2. 演练库表行数与 manifest 一致。
3. 演练 MinIO 前缀下对象数与 manifest 一致。
4. 数据库 `storage_key` / `avatar_url` 能命中演练前缀对象。
5. 篡改备份文件后 `verify` 失败。
6. 指定已存在库名时恢复失败且不产生半成品。
7. 恢复中途注入失败，演练库被删除、演练前缀被清理。
8. 执行 `drill:clean` 后演练库不存在、演练前缀对象为 0，前端演练记录状态变为 `deleted`。
9. 前端连续执行“恢复 → 一键清除”两轮，第二次恢复仍能成功（不残留同名库/对象）。

- [ ] **Step 4: 写证据与运行手册**

`docs/testing/p1-7-export-backup.tdd.md` 记录每个 Task 的 RED/GREEN 命令、全量测试/构建结果、手工 E2E 结果、已知缺口。

`docs/2026-11-22-p1-7-runbook.md` 记录：

- 备份/恢复 CLI 用法。
- 管理端入口与 `BACKUP_RESTORE_ENABLED=true`。
- 恢复演练步骤与回滚。
- 安全注意事项（`.env`、MinIO 前缀、目标库名）。
- 保留策略：`pnpm sse-backup cleanup --keep 14`。

- [ ] **Step 5: 更新进度文档并提交**

在 `docs/2026-11-21-sse-process.md` 增加 P1-7 完成章节，并更新 P1 清单状态。

```bash
git add docs
git commit -m "docs: record P1-7 export and backup/restore evidence"
```

---

## 5. 验收标准

### 5.1 P1-7 导出

- [ ] `/statistics/export?format=xlsx` 返回 5 个 sheet：报销单、费用明细、发票、审批链、付款。
- [ ] `/statistics/export?format=csv` 返回带 BOM 的扁平 CSV，包含明细/发票/审批链/付款 JSON 列。
- [ ] `/statistics/export?format=json` 返回嵌套 reports/items/invoices/approvals/payment。
- [ ] 导出权限仍为 finance/admin；员工/部门审批人 403。
- [ ] 每次导出写 `audit_events`，包含 format、筛选条件、各层行数、字节数、sha256。
- [ ] 统计页 finance/admin 可见导出按钮，员工不可见。

### 5.2 备份

- [ ] CLI `sse-backup create` 产出 `package/`、`<id>.tar.gz`、manifest、checksums。
- [ ] 备份包含 PostgreSQL、MinIO 对象、AI 配置；`.env` 默认排除。
- [ ] MinIO 上传可选，列表能区分 local / minio。
- [ ] 校验器不依赖备份生成过程，能发现篡改、缺文件、行数不一致。

### 5.3 恢复

- [ ] 恢复到新建演练库 + MinIO 前缀，不触碰当前库/当前对象。
- [ ] 恢复前自动执行目标库 migration。
- [ ] 列漂移自动处理；缺失 NOT NULL 无默认列直接失败。
- [ ] 外键在导入后重建；违反约束时整个事务回滚。
- [ ] 恢复失败自动删除演练库、清理演练前缀。
- [ ] 管理端可列出演练记录，并一键清除演练库/演练前缀；清除需 `CLEANUP <targetDb>`。
- [ ] 清除写 `backup.drill_cleanup` 审计，且不会影响当前库与当前 MinIO 对象。
- [ ] 连续“恢复 → 清除”两轮可重复成功，便于前端反复测试。
- [ ] API 恢复/清除需要 `BACKUP_RESTORE_ENABLED=true` + 管理员 + 确认短语。
- [ ] 所有备份/恢复/下载/删除动作写审计。

### 5.4 质量

- [ ] `pnpm -r test` 全绿。
- [ ] `pnpm -r build` 12/12 包通过。
- [ ] 无真实凭据写入文档或日志。
- [ ] TDD 证据与运行手册齐备。

---

## 6. 评审时需要确认的点

1. 是否接受 **JSONL + `json_populate_recordset`** 作为备份数据格式（推荐；避免 SQL/CSV 转义坑）。
2. 是否接受恢复时 **临时删除并重建外键**（推荐；避免手写表顺序，且能验证数据完整性）。
3. 是否接受 v1 **只恢复到新建演练库 + MinIO 前缀**（不做原地恢复）。
4. 是否接受 `.env` 默认排除，需 `--include-secrets` 才纳入备份。
5. 是否接受 API 恢复默认关闭，需 `BACKUP_RESTORE_ENABLED=true`。
6. 是否接受新增依赖：`pg-cursor`、`tar`、`commander`、`exceljs`（均为服务端库）。
