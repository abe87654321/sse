import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { GraphCounts, GraphQueryResult, GraphStore, ProjectedQuad } from './types';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class OxigraphStore implements GraphStore {
  private worker!: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private checkpointNquads = '';
  private dirty = false;
  private ready: Promise<void> = Promise.resolve();

  constructor(private workerPath = process.env.ONTOLOGY_WORKER_PATH || join(__dirname, 'oxigraph-worker.js')) {
    this.spawn();
  }

  private spawn(): void {
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
    w.on('error', (err) => { if (this.worker === w) this.failAll(err as Error); });
    w.on('exit', (code) => { if (this.worker === w && code !== 0) this.failAll(new Error(`graph worker exited ${code}`)); });
    if (this.checkpointNquads) {
      const id = ++this.seq;
      this.ready = new Promise((resolve, reject) => {
        this.pending.set(id, {
          resolve: () => resolve(),
          reject,
          timer: setTimeout(() => reject(new Error('worker restore timeout')), 10_000),
        });
        w.postMessage({ id, type: 'load', nquads: this.checkpointNquads });
      });
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
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('SPARQL timeout'));
          this.dirty = true;
          const old = this.worker;
          this.failAll(new Error('graph worker restarted after timeout'));
          void old.terminate();
          this.spawn();
        }, timeoutMs)
        : setTimeout(() => {}, 0);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  query(sparql: string, opts?: { timeoutMs?: number }): Promise<GraphQueryResult> {
    return this.call('query', { sparql }, opts?.timeoutMs ?? 1500);
  }
  update(sparql: string): Promise<void> { return this.call('update', { sparql }); }
  load(nquads: string): Promise<void> {
    this.checkpointNquads = this.checkpointNquads ? `${this.checkpointNquads}\n${nquads}` : nquads;
    this.dirty = false;
    return this.call('load', { nquads });
  }
  replaceAll(nquads: string): Promise<void> {
    this.checkpointNquads = nquads;
    this.dirty = false;
    return this.call('replaceAll', { nquads });
  }
  dump(graphs: string[]): Promise<string> { return this.call('dump', { graphs }); }
  replaceEntity(subject: string, quads: ProjectedQuad[], ownedPredicates: string[]): Promise<void> {
    return this.call('replaceEntity', { subject, quads, ownedPredicates });
  }
  addRelation(from: string, predicate: string, to: string): Promise<void> {
    return this.call('addRelation', { from, predicate, to });
  }
  removeRelation(from: string, predicate: string, to: string): Promise<void> {
    return this.call('removeRelation', { from, predicate, to });
  }
  deleteSubject(subject: string): Promise<void> { return this.call('delete', { subject }); }
  checkpoint(nquads: string): void { this.checkpointNquads = nquads; }
  needsRebuild(): boolean { return this.dirty; }
  counts(): Promise<GraphCounts> { return this.call('counts', {}); }
  async close(): Promise<void> { await this.worker.terminate(); }
}
