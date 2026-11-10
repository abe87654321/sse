import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { GraphCounts, GraphQueryResult, GraphStore, ProjectedQuad } from './types';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

const DEFAULT_QUERY_TIMEOUT_MS = 1500;
const RESTORE_TIMEOUT_MS = 10_000;

function callTimeoutMs(): number {
  const configured = Number(process.env.ONTOLOGY_GRAPH_CALL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 30_000;
}

export class OxigraphStore implements GraphStore {
  private worker!: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private checkpointNquads = '';
  private dirty = false;
  private ready: Promise<void> = Promise.resolve();
  private intentionalClose = false;
  private respawning = false;

  constructor(private workerPath = process.env.ONTOLOGY_WORKER_PATH || join(__dirname, 'oxigraph-worker.js')) {
    this.spawn();
  }

  private spawn(restoreCheckpoint = true): void {
    const w = new Worker(this.workerPath);
    this.worker = w;
    w.on('message', (msg: any) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    w.on('error', (err) => {
      if (this.worker !== w || this.intentionalClose) return;
      this.handleWorkerFailure(err as Error);
    });
    w.on('exit', (code) => {
      if (this.worker !== w || this.intentionalClose) return;
      if (code !== 0) this.handleWorkerFailure(new Error(`graph worker exited ${code}`));
    });
    if (restoreCheckpoint && this.checkpointNquads) {
      this.ready = this.restore(w, this.checkpointNquads);
    } else {
      this.ready = Promise.resolve();
    }
  }

  private restore(w: Worker, nquads: string): Promise<void> {
    return new Promise<void>((resolveReady) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.dirty = true;
        console.error('[ontology] checkpoint restore timed out; starting with an empty graph');
        if (this.worker === w) {
          this.spawn(false);
          void w.terminate().catch(() => {});
        }
        resolveReady();
      }, RESTORE_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          resolveReady();
        },
        reject: (err) => {
          clearTimeout(timer);
          this.dirty = true;
          console.error(`[ontology] checkpoint restore failed: ${err.message}; starting with an empty graph`);
          if (!this.respawning && !this.intentionalClose && this.worker === w) {
            this.spawn(false);
            void w.terminate().catch(() => {});
          }
          resolveReady();
        },
        timer,
      });
      w.postMessage({ id, type: 'load', nquads });
    });
  }

  private handleWorkerFailure(err: Error): void {
    if (this.intentionalClose || this.respawning) return;
    this.respawning = true;
    try {
      this.dirty = true;
      const old = this.worker;
      this.failAll(err);
      this.spawn(true);
      void old.terminate().catch(() => {});
    } finally {
      this.respawning = false;
    }
  }

  private failAll(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private async call(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<any> {
    await this.ready;
    if (this.intentionalClose) throw new Error('graph store closed');
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
          if (!this.pending.delete(id)) return;
          reject(new Error('SPARQL timeout'));
          this.handleWorkerFailure(new Error('graph worker restarted after timeout'));
        }, timeoutMs)
        : setTimeout(() => {}, 0);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  query(sparql: string, opts?: { timeoutMs?: number }): Promise<GraphQueryResult> {
    return this.call('query', { sparql }, opts?.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS);
  }
  update(sparql: string): Promise<void> {
    return this.call('update', { sparql }, callTimeoutMs());
  }
  async load(nquads: string): Promise<void> {
    await this.call('load', { nquads }, callTimeoutMs());
    if (!nquads) return;
    const base = this.checkpointNquads.replace(/\n+$/, '');
    const next = base ? nquads.replace(/^\n+/, '') : nquads;
    this.checkpointNquads = base && next ? `${base}\n${next}` : (base || next);
  }
  async replaceAll(nquads: string): Promise<void> {
    await this.call('replaceAll', { nquads }, callTimeoutMs());
    this.checkpointNquads = nquads;
    this.dirty = false;
  }
  dump(graphs: string[]): Promise<string> {
    return this.call('dump', { graphs }, callTimeoutMs());
  }
  replaceEntity(subject: string, quads: ProjectedQuad[], ownedPredicates: string[]): Promise<void> {
    return this.call('replaceEntity', { subject, quads, ownedPredicates }, callTimeoutMs());
  }
  addRelation(from: string, predicate: string, to: string): Promise<void> {
    return this.call('addRelation', { from, predicate, to }, callTimeoutMs());
  }
  removeRelation(from: string, predicate: string, to: string): Promise<void> {
    return this.call('removeRelation', { from, predicate, to }, callTimeoutMs());
  }
  deleteSubject(subject: string): Promise<void> {
    return this.call('delete', { subject }, callTimeoutMs());
  }
  checkpoint(nquads: string): void {
    this.checkpointNquads = nquads;
  }
  needsRebuild(): boolean {
    return this.dirty;
  }
  counts(): Promise<GraphCounts> {
    return this.call('counts', {}, callTimeoutMs());
  }
  async close(): Promise<void> {
    this.intentionalClose = true;
    this.failAll(new Error('graph store closed'));
    await this.worker.terminate();
  }
}
