import { pool } from '@sse/db';
import {
  GRAPH,
  GraphProjector,
  OxigraphStore,
  SnapshotRepo,
  loadTBox,
  reconcile,
  setGraphContext,
} from '@sse/ontology';

export interface ProjectorDeps {
  drain: (n?: number) => Promise<{ processed: number; failed: number; deadLettered: number }>;
  purgeOldEvents: (days?: number) => Promise<number>;
  snapshot: () => Promise<void>;
  runRules?: () => Promise<void>;
  /** True after a worker timeout/respawn; the runner must reconcile from DB. */
  needsRebuild: () => boolean;
  reconcile: () => Promise<void>;
}

export class ProjectorRunner {
  private timer?: NodeJS.Timeout;
  private ticks = 0;
  private stopped = false;

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
    if (this.timer) clearInterval(this.timer);
    await this.deps.snapshot();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      if (this.deps.needsRebuild()) {
        console.error('[ontology] graph worker respawned; running full reconcile');
        await this.deps.reconcile();
      }
      const { processed, failed, deadLettered } = await this.deps.drain();
      if (processed > 0) await this.deps.runRules?.();
      this.ticks++;
      if (processed > 0 && this.ticks % this.opts.snapshotEvery === 0) await this.deps.snapshot();
      if (failed > 0) console.error(`[ontology] projector failures: ${failed}`);
      if (deadLettered > 0) console.error(`[ontology] dead-lettered rows: ${deadLettered}`);
    } catch (err: any) {
      console.error(`[ontology] projector tick failed: ${err?.message ?? err}`);
    }
  }
}

let runner: ProjectorRunner | undefined;
let liveStore: OxigraphStore | undefined;

export async function startOntologyProjector(): Promise<void> {
  if (runner) return;

  const mode = process.env.ONTOLOGY_V2;
  if (mode !== 'on' && mode !== 'shadow') return;

  // Enable the outbox triggers only now that a projector is running.
  await pool.query(`UPDATE ontology_settings SET value = 'true', updated_at = NOW() WHERE key = 'outbox_enabled'`);

  const store = new OxigraphStore();
  const snapshots = new SnapshotRepo(pool);
  const latest = await snapshots.latest();

  // Load the TBox first. The snapshot already includes the TBox, so restoring
  // the full snapshot afterwards leaves the respawn checkpoint complete.
  await loadTBox(store);

  if (latest) {
    await store.replaceAll(latest.nquads);
    await pool.query(
      `UPDATE ontology_projector_state
          SET last_outbox_id = GREATEST(last_outbox_id, $1), updated_at = NOW()
        WHERE id = 'default'`,
      [latest.lastOutboxId],
    );
  } else {
    await reconcile(store, pool);
  }

  setGraphContext(store, pool);
  liveStore = store;

  const projector = new GraphProjector(store, pool);
  const graphNames = [GRAPH.tbox, GRAPH.data, GRAPH.inferred, GRAPH.history, GRAPH.manual];

  runner = new ProjectorRunner({
    drain: (n) => projector.drain(n),
    purgeOldEvents: (d) => projector.purgeOldEvents(d),
    snapshot: async () => {
      const nquads = await store.dump(graphNames);
      const state = await pool.query(`SELECT last_outbox_id FROM ontology_projector_state WHERE id = 'default'`);
      const lastOutboxId = Number(state.rows[0]?.last_outbox_id ?? 0);
      store.checkpoint(nquads);
      await snapshots.save(graphNames, nquads, lastOutboxId);
    },
    needsRebuild: () => store.needsRebuild(),
    reconcile: async () => { await reconcile(store, pool); },
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
  runner.start();
}

export async function stopOntologyProjector(): Promise<void> {
  await runner?.stop();
  runner = undefined;
  if (liveStore) {
    await liveStore.close();
    liveStore = undefined;
  }
}
