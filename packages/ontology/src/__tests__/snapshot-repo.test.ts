import { createHash } from 'crypto';
import { SnapshotRepo } from '../graph/snapshot-repo';

class FakePool {
  rows: any[] = [];
  state = { id: 'default', last_outbox_id: 0, last_snapshot_version: 0 };
  private seq = 0;

  async query(sql: string, params?: any[]) {
    const statement = sql.replace(/\s+/g, ' ').trim();

    if (statement.startsWith('SELECT nextval')) {
      return { rows: [{ version: ++this.seq }] };
    }
    if (statement.startsWith('INSERT INTO ontology_graph_snapshots')) {
      const row = {
        id: String(this.rows.length + 1),
        version: Number(params![0]),
        checksum: params![1],
        nquads: params![2],
        graph_names: params![3],
        last_outbox_id: Number(params![4]),
        created_at: new Date(),
      };
      this.rows.push(row);
      return { rows: [row] };
    }
    if (statement.startsWith('UPDATE ontology_projector_state')) {
      this.state.last_snapshot_version = Number(params![0]);
      this.state.last_outbox_id = Math.max(this.state.last_outbox_id, Number(params![1]));
      return { rows: [] };
    }
    if (statement.startsWith('DELETE FROM ontology_graph_snapshots')) {
      const keep = Number(params![0]);
      this.rows.sort((a, b) => b.version - a.version);
      this.rows = this.rows.slice(0, keep);
      return { rows: [] };
    }
    if (statement.startsWith('SELECT') && statement.includes('ontology_graph_snapshots')) {
      if (this.rows.length === 0) return { rows: [] };
      const sorted = [...this.rows].sort((a, b) => b.version - a.version);
      return { rows: [sorted[0]] };
    }
    return { rows: [] };
  }
}

const NQUADS = '<a> <b> <c> <urn:sse:data> .\n';

describe('SnapshotRepo', () => {
  it('round-trips nquads, checksum, graph list and outbox watermark', async () => {
    const repo = new SnapshotRepo(new FakePool() as any);
    const saved = await repo.save(
      ['urn:sse:data', 'urn:sse:inferred', 'urn:sse:history'],
      NQUADS,
      42,
    );
    expect(saved.version).toBe(1);
    expect(saved.checksum).toBe(createHash('sha256').update(NQUADS).digest('hex'));
    expect(saved.graphNames).toEqual(['urn:sse:data', 'urn:sse:inferred', 'urn:sse:history']);
    expect(saved.lastOutboxId).toBe(42);
    const loaded = await repo.latest();
    expect(loaded?.checksum).toBe(saved.checksum);
    expect(loaded?.nquads).toContain('<a> <b> <c>');
    expect(loaded?.lastOutboxId).toBe(42);
  });

  it('computes a canonical checksum that ignores line order', async () => {
    const repo = new SnapshotRepo(new FakePool() as any);
    const forward = '<a> <b> <c> <urn:sse:data> .\n<d> <e> <f> <urn:sse:data> .\n';
    const reversed = '<d> <e> <f> <urn:sse:data> .\n<a> <b> <c> <urn:sse:data> .\n';
    const first = await repo.save(['urn:sse:data'], forward, 1);
    const second = await repo.save(['urn:sse:data'], reversed, 2);
    expect(first.checksum).toBe(second.checksum);
  });

  it('increments the version on every save', async () => {
    const repo = new SnapshotRepo(new FakePool() as any);
    const first = await repo.save(['urn:sse:data'], NQUADS, 1);
    const second = await repo.save(['urn:sse:data'], NQUADS, 2);
    const third = await repo.save(['urn:sse:data'], NQUADS, 3);
    expect([first.version, second.version, third.version]).toEqual([1, 2, 3]);
  });

  it('prunes to the newest five snapshots', async () => {
    const pool = new FakePool();
    const repo = new SnapshotRepo(pool as any);
    for (let i = 1; i <= 7; i += 1) {
      await repo.save(['urn:sse:data'], NQUADS, i);
    }
    expect(pool.rows).toHaveLength(5);
    expect(pool.rows.map(row => row.version).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7]);
  });

  it('updates ontology_projector_state with the last outbox id', async () => {
    const pool = new FakePool();
    const repo = new SnapshotRepo(pool as any);
    await repo.save(['urn:sse:data'], NQUADS, 99);
    expect(pool.state.last_snapshot_version).toBe(1);
    expect(pool.state.last_outbox_id).toBe(99);
  });

  it('throws when the stored checksum does not match the nquads', async () => {
    const pool = new FakePool();
    const repo = new SnapshotRepo(pool as any);
    await repo.save(['urn:sse:data'], NQUADS, 1);
    pool.rows[0].nquads = '<a> <b> "tampered" <urn:sse:data> .\n';
    await expect(repo.latest()).rejects.toThrow(/version 1/i);
  });
});
