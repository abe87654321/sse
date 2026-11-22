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

export interface BackupJobDeps {
  backupDir: string;
  acquireLock: () => Promise<{ release(): Promise<void> }>;
  createBackup: (options: any) => Promise<any>;
  verifyBackup: (id: string) => Promise<any>;
  restoreBackup: (options: any) => Promise<any>;
  cleanupDrill: (options: any) => Promise<any>;
  resolvePackage: (id: string) => Promise<string>;
  listRestoreRecords: (backupDir: string) => any[];
}

export class BackupJobService {
  private readonly jobs = new Map<string, BackupJob>();
  private active: string | null = null;

  constructor(private readonly deps: BackupJobDeps) {
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
      let lock: { release(): Promise<void> } | undefined;
      try {
        lock = await this.deps.acquireLock();
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
        if (lock) await lock.release();
      }
    })();
    return job;
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
