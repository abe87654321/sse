import { randomUUID } from 'crypto';
import { getGraphStore, getPool } from '../graph/graph-context';
import type { GraphCounts } from '../graph/types';
import { reconcile } from './reconcile';

export interface ReconcileJob {
  id: string;
  state: 'running' | 'done' | 'failed';
  counts?: GraphCounts;
  checksum?: string;
  lastOutboxId?: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const jobs = new Map<string, ReconcileJob>();

export function startReconcileJob(): ReconcileJob {
  const job: ReconcileJob = {
    id: randomUUID(),
    state: 'running',
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      const result = await reconcile(getGraphStore(), getPool());
      job.state = 'done';
      job.counts = result.counts;
      job.checksum = result.checksum;
      job.lastOutboxId = result.lastOutboxId;
      job.finishedAt = new Date().toISOString();
    } catch (err: any) {
      job.state = 'failed';
      job.error = String(err?.message ?? err);
      job.finishedAt = new Date().toISOString();
    }
  })();

  return job;
}

export function getReconcileJob(id: string): ReconcileJob | undefined {
  return jobs.get(id);
}
