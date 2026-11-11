import { pool } from '@sse/db';
import {
  GRAPH,
  GraphProjector,
  OxigraphStore,
  RuleEngine,
  SnapshotRepo,
  compareShadow,
  loadTBox,
  reconcile,
  setGraphContext,
  setLastShadowReport,
  type ShadowReport,
} from '@sse/ontology';

export interface ProjectorDeps {
  drain: (n?: number) => Promise<{ processed: number; failed: number; deadLettered: number }>;
  purgeOldEvents: (days?: number) => Promise<number>;
  snapshot: () => Promise<void>;
  runRules: () => Promise<number>;
  /** True after a worker timeout/respawn; the runner must reconcile from DB. */
  needsRebuild: () => boolean;
  reconcile: () => Promise<void>;
  /** Current oldest pending outbox age in milliseconds (metrics only). */
  outboxLagMs?: () => Promise<number>;
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export function maxOutboxBatch(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(1, Number(env.ONTOLOGY_MAX_OUTBOX_BATCH) || 200);
}

export function outboxRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(1, Number(env.ONTOLOGY_OUTBOX_RETENTION_DAYS) || 7);
}

export function shadowSampleRows(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(1, Math.min(1000, Math.floor(Number(env.ONTOLOGY_SHADOW_SAMPLE_ROWS) || 200)));
}

export interface ShadowLogSummary {
  equal: boolean;
  checkedAt: string;
  differences: number;
  byKind: Record<string, number>;
  byTable: Record<string, number>;
}

/** Aggregate-only shape: row IDs and values must never reach stderr. */
export function shadowLogSummary(report: ShadowReport): ShadowLogSummary {
  const byKind: Record<string, number> = {};
  const byTable: Record<string, number> = {};
  for (const difference of report.differences) {
    byKind[difference.kind] = (byKind[difference.kind] ?? 0) + 1;
    byTable[difference.table] = (byTable[difference.table] ?? 0) + 1;
  }
  return {
    equal: report.equal,
    checkedAt: report.checkedAt,
    differences: report.differences.length,
    byKind,
    byTable,
  };
}

export function logShadowReport(report: ShadowReport): void {
  console.error(`[ontology-shadow] ${JSON.stringify(shadowLogSummary(report))}`);
}

export interface SnapshotStoreLike {
  dump(graphs: string[]): Promise<string>;
  checkpoint(nquads: string): void;
}

export interface SnapshotSaverLike {
  save(graphNames: string[], nquads: string, lastOutboxId: number): Promise<unknown>;
}

export interface SnapshotPoolLike {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}

/**
 * Persist a graph snapshot with a deliberate watermark ordering.
 *
 * The watermark is read before the dump. A watermark that is older than the
 * dumped content is safe because replaying outbox rows is idempotent; a
 * watermark ahead of the dump would skip rows and lose data. `SnapshotRepo.save`
 * also advances the projector watermark with GREATEST(...), so a slower
 * concurrent drain cannot move it backwards.
 */
export async function persistGraphSnapshot(opts: {
  store: SnapshotStoreLike;
  pool: SnapshotPoolLike;
  snapshots: SnapshotSaverLike;
  graphNames: string[];
}): Promise<number> {
  const state = await opts.pool.query(
    `SELECT last_outbox_id FROM ontology_projector_state WHERE id = 'default'`,
  );
  const lastOutboxId = Number(state.rows[0]?.last_outbox_id ?? 0) || 0;
  const nquads = await opts.store.dump(opts.graphNames);
  opts.store.checkpoint(nquads);
  await opts.snapshots.save(opts.graphNames, nquads, lastOutboxId);
  return lastOutboxId;
}

export interface ProjectorStartupDeps {
  pool: SnapshotPoolLike;
  store: SnapshotStoreLike & { replaceAll(nquads: string): Promise<void> };
  snapshots: {
    latest(): Promise<{ nquads: string; lastOutboxId: number } | null>;
  };
  loadTBox: (store: any) => Promise<unknown>;
  reconcile: (store: any, pool: any) => Promise<unknown>;
  setContext: (store: any, pool: any) => void;
  runner: { start(): void };
  startShadow?: (store: any) => void;
}

async function setOutboxEnabled(pool: SnapshotPoolLike, enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE ontology_settings SET value = $1, updated_at = NOW() WHERE key = 'outbox_enabled'`,
    [enabled ? 'true' : 'false'],
  );
}

/**
 * Startup sequence with injectable dependencies so the failure path is testable.
 *
 * Triggers stay disabled until the TBox, snapshot restore/reconcile and runner
 * are all healthy. Any failure disables them again and rethrows; leaving
 * triggers enabled without a projector would grow the outbox forever.
 */
export async function startOntologyProjectorWith(deps: ProjectorStartupDeps): Promise<void> {
  await setOutboxEnabled(deps.pool, false);

  try {
    // The snapshot already includes the TBox, so restoring the full snapshot
    // afterwards leaves the respawn checkpoint complete.
    await deps.loadTBox(deps.store);

    let restored = false;
    try {
      const latest = await deps.snapshots.latest();
      if (latest) {
        await deps.store.replaceAll(latest.nquads);
        await deps.pool.query(
          `UPDATE ontology_projector_state
              SET last_outbox_id = GREATEST(last_outbox_id, $1), updated_at = NOW()
            WHERE id = 'default'`,
          [latest.lastOutboxId],
        );
        restored = true;
      }
    } catch (err: any) {
      console.error(`[ontology] snapshot restore failed; falling back to reconcile: ${err?.message ?? err}`);
    }

    if (!restored) {
      await deps.reconcile(deps.store, deps.pool);
    }

    deps.setContext(deps.store, deps.pool);
    deps.runner.start();
    await setOutboxEnabled(deps.pool, true);
    deps.startShadow?.(deps.store);
  } catch (err: any) {
    try {
      await setOutboxEnabled(deps.pool, false);
    } catch (disableErr: any) {
      console.error(`[ontology] failed to disable outbox triggers after startup failure: ${disableErr?.message ?? disableErr}`);
    }
    console.error(`[ontology] projector startup failed; outbox triggers disabled: ${err?.message ?? err}`);
    throw err;
  }
}

export class ProjectorRunner {
  private timer?: NodeJS.Timeout;
  private ticks = 0;
  private stopped = false;
  private inFlight: Promise<void> | null = null;
  private lastPurgeAt = 0;

  constructor(
    private readonly deps: ProjectorDeps,
    private readonly opts = { intervalMs: 1000, snapshotEvery: 5 },
  ) {}

  start(): void {
    this.timer = setInterval(() => { void this.tick(); }, this.opts.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // Let the current drain + snapshot finish before taking the final snapshot,
    // otherwise the snapshot could capture a half-applied batch.
    if (this.inFlight) await this.inFlight;
    await this.deps.snapshot();
  }

  tick(): Promise<void> {
    if (this.stopped || this.inFlight) return Promise.resolve();
    this.inFlight = this.runOnce().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runOnce(): Promise<void> {
    if (this.stopped) return;
    const startedAt = Date.now();
    try {
      await this.maybePurge();
      if (this.deps.needsRebuild()) {
        console.error('[ontology] graph worker respawned; running full reconcile');
        await this.deps.reconcile();
      }
      const { processed, failed, deadLettered } = await this.deps.drain();
      if (processed > 0) await this.deps.runRules();
      this.ticks++;
      if (processed > 0 && this.ticks % this.opts.snapshotEvery === 0) await this.deps.snapshot();
      if (deadLettered > 0) console.error(`[ontology] dead-lettered rows: ${deadLettered}`);
      if (processed > 0) {
        let lagMs = 0;
        if (this.deps.outboxLagMs) {
          try {
            lagMs = await this.deps.outboxLagMs();
          } catch {
            lagMs = 0;
          }
        }
        console.error(
          `[ontology-projector] ${JSON.stringify({
            processed,
            failed,
            lag_ms: lagMs,
            duration_ms: Date.now() - startedAt,
          })}`,
        );
      }
    } catch (err: any) {
      console.error(`[ontology] projector tick failed: ${err?.message ?? err}`);
    }
  }

  private async maybePurge(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now;
    try {
      await this.deps.purgeOldEvents();
    } catch (err: any) {
      console.error(`[ontology] outbox purge failed: ${err?.message ?? err}`);
    }
  }
}

let runner: ProjectorRunner | undefined;
let liveStore: OxigraphStore | undefined;
let shadowTimer: NodeJS.Timeout | undefined;
let shadowInFlight = false;

async function outboxLagMs(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(
       EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at))) FILTER (
         WHERE processed_at IS NULL AND dead_letter = false
       ),
       0
     ) AS oldest_pending_age_seconds
       FROM ontology_outbox`,
  );
  return Number(rows[0]?.oldest_pending_age_seconds ?? 0) * 1000;
}

async function runShadowComparison(store: OxigraphStore): Promise<void> {
  if (shadowInFlight) {
    console.error('[ontology-shadow] skipped: previous comparison is still running');
    return;
  }
  shadowInFlight = true;
  try {
    const report = await compareShadow(store, pool, { sampleSize: shadowSampleRows() });
    setLastShadowReport(report);
    logShadowReport(report);
  } catch (err: any) {
    console.error(`[ontology-shadow] comparison failed: ${err?.message ?? err}`);
  } finally {
    shadowInFlight = false;
  }
}

function startShadowComparison(store: OxigraphStore): void {
  const intervalMs = Math.max(
    1000,
    Number(process.env.ONTOLOGY_SHADOW_INTERVAL_MS) || 300000,
  );
  void runShadowComparison(store);
  shadowTimer = setInterval(() => { void runShadowComparison(store); }, intervalMs);
  shadowTimer.unref?.();
  console.error(`[ontology-shadow] comparison scheduled every ${intervalMs}ms`);
}

export async function startOntologyProjector(): Promise<void> {
  if (runner) return;

  const mode = process.env.ONTOLOGY_V2;
  if (mode !== 'on' && mode !== 'shadow') return;

  console.error(
    '[ontology] v2 requires a single API instance; multi-replica deployments serve stale graphs unless a shared graph store is used',
  );

  let createdStore: OxigraphStore | undefined;
  try {
    const store = new OxigraphStore();
    createdStore = store;
    const snapshots = new SnapshotRepo(pool);

    const projector = new GraphProjector(store, pool, {
      batchSize: maxOutboxBatch(),
    });
    const rules = new RuleEngine(store, pool);
    const graphNames = [GRAPH.tbox, GRAPH.data, GRAPH.inferred, GRAPH.history, GRAPH.manual];

    const nextRunner = new ProjectorRunner({
      drain: (n) => projector.drain(n),
      purgeOldEvents: (d) => projector.purgeOldEvents(d ?? outboxRetentionDays()),
      runRules: () => rules.materialize(),
      snapshot: async () => {
        await persistGraphSnapshot({ store, pool, snapshots, graphNames });
      },
      needsRebuild: () => store.needsRebuild(),
      reconcile: async () => { await reconcile(store, pool); },
      outboxLagMs,
    }, {
      intervalMs: Number(process.env.ONTOLOGY_PROJECT_INTERVAL_MS) || 1000,
      snapshotEvery: Math.max(
        1,
        Math.floor(
          (Number(process.env.ONTOLOGY_SNAPSHOT_INTERVAL_MS) || 5000) /
          (Number(process.env.ONTOLOGY_PROJECT_INTERVAL_MS) || 1000),
        ),
      ),
    });

    runner = nextRunner;
    liveStore = store;

    await startOntologyProjectorWith({
      pool,
      store,
      snapshots,
      loadTBox,
      reconcile,
      setContext: setGraphContext,
      runner: nextRunner,
      startShadow: mode === 'shadow' ? startShadowComparison : undefined,
    });
  } catch (err: any) {
    runner = undefined;
    liveStore = undefined;
    if (createdStore) await createdStore.close().catch(() => undefined);
    try {
      await setOutboxEnabled(pool, false);
    } catch { /* the API exits non-zero below */ }
    console.error(
      `[ontology] projector startup failed; outbox triggers disabled: ${err?.message ?? err}`,
    );
    throw err;
  }
}

export async function stopOntologyProjector(): Promise<void> {
  if (shadowTimer) {
    clearInterval(shadowTimer);
    shadowTimer = undefined;
  }
  shadowInFlight = false;
  setLastShadowReport(null);
  await runner?.stop();
  runner = undefined;
  if (liveStore) {
    await liveStore.close();
    liveStore = undefined;
  }
}
