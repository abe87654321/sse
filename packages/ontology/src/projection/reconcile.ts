import { canonicalChecksum } from '../graph/checksum';
import { MemoryGraphStore } from '../graph/memory-store';
import { GRAPH } from '../graph/namespaces';
import { SnapshotRepo } from '../graph/snapshot-repo';
import { loadTBox } from '../graph/ontology-loader';
import type { GraphCounts, GraphStore } from '../graph/types';
import { RuleEngine } from '../reasoning/rule-engine';
import { projectRow, type MappedTable } from './entity-mapper';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const BATCH_SIZE = 500;

const GRAPH_NAMES = [GRAPH.tbox, GRAPH.data, GRAPH.inferred, GRAPH.history, GRAPH.manual];

const TABLES: MappedTable[] = [
  'users',
  'expense_categories',
  'expense_reports',
  'expense_items',
  'invoices',
  'approval_rules',
  'approval_records',
  'payment_receipts',
];

export interface ReconcileQueryResultLike {
  rows: any[];
  rowCount?: number | null;
}

export interface ReconcileClient {
  query(sql: string, params?: any[]): Promise<ReconcileQueryResultLike>;
  release(): void;
}

export interface ReconcilePool {
  query(sql: string, params?: any[]): Promise<ReconcileQueryResultLike>;
  connect?(): Promise<ReconcileClient>;
}

export interface ReconcileOptions {
  batchSize?: number;
}

export interface RebuildResult {
  counts: GraphCounts;
  checksum: string;
  nquads: string;
}

export interface ReconcileResult extends RebuildResult {
  lastOutboxId: number;
}

async function projectTable(
  store: GraphStore,
  pool: ReconcilePool,
  table: MappedTable,
  batchSize: number,
): Promise<void> {
  let lastId = ZERO_UUID;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT * FROM ${table} WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, batchSize],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const projection = projectRow(table, 'INSERT', row);
      for (const write of projection.writes) {
        await store.replaceEntity(write.uri, write.quads, write.ownedPredicates);
      }
      for (const relation of projection.add) {
        await store.addRelation(relation.from, relation.predicate, relation.to);
      }
    }

    lastId = String(rows[rows.length - 1].id);
    if (rows.length < batchSize) break;
  }
}

export async function rebuildGraph(
  target: GraphStore,
  pool: ReconcilePool,
  opts: ReconcileOptions = {},
): Promise<RebuildResult> {
  const batchSize = Math.max(1, opts.batchSize ?? BATCH_SIZE);
  const fresh = new MemoryGraphStore();
  await loadTBox(fresh);

  const history = await target.dump([GRAPH.history]);
  if (history.trim() !== '') await fresh.load(history);

  for (const table of TABLES) {
    await projectTable(fresh, pool, table, batchSize);
  }

  // Materialize rules into urn:sse:inferred before dumping so the snapshot
  // contains the same conclusions the incremental projector would produce.
  const rules = new RuleEngine(fresh, pool);
  await rules.materialize();

  const nquads = await fresh.dump(GRAPH_NAMES);
  const checksum = canonicalChecksum(nquads);
  await target.replaceAll(nquads);
  target.checkpoint(nquads);

  const counts = await target.counts();
  return { counts, checksum, nquads };
}

async function withProjectorLock<T>(pool: ReconcilePool, fn: () => Promise<T>): Promise<T> {
  if (typeof pool.connect !== 'function') return fn();

  const client = await pool.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(728001) AS ok');
    if (!lock.rows[0]?.ok) {
      throw new Error('ontology projector lock is held; retry reconcile later');
    }
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(728001)').catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export async function reconcile(
  liveStore: GraphStore,
  pool: ReconcilePool,
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  return withProjectorLock(pool, async () => {
    // Capture the watermark before scanning. Rows written while we scan are
    // newer than this id and will be drained by the projector afterwards.
    const watermark = await pool.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM ontology_outbox');
    const lastOutboxId = Number(watermark.rows[0]?.max_id ?? 0);

    const rebuilt = await rebuildGraph(liveStore, pool, opts);

    await pool.query(
      `UPDATE ontology_projector_state
          SET last_outbox_id = GREATEST(last_outbox_id, $1), updated_at = NOW()
        WHERE id = 'default'`,
      [lastOutboxId],
    );

    const snapshots = new SnapshotRepo(pool);
    await snapshots.save(GRAPH_NAMES, rebuilt.nquads, lastOutboxId);
    liveStore.checkpoint(rebuilt.nquads);

    return { ...rebuilt, lastOutboxId };
  });
}
