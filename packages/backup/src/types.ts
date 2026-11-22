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
