import { SnapshotRepo } from '../graph/snapshot-repo';

class FakePool {
  rows: any[] = [];
  async query(sql: string, params?: any[]) {
    if (sql.startsWith('INSERT INTO ontology_graph_snapshots')) {
      const row = { id: String(this.rows.length + 1), version: params![0], checksum: params![1], nquads: params![2], graph_names: params![3], last_outbox_id: params![4], created_at: new Date() };
      this.rows.push(row);
      return { rows: [row] };
    }
    if (sql.includes('MAX(version)')) {
      const max = this.rows.reduce((m, r) => Math.max(m, r.version), 0);
      return { rows: [{ version: max + 1 }] };
    }
    if (sql.startsWith('SELECT') && sql.includes('ontology_graph_snapshots')) {
      return { rows: [this.rows[this.rows.length - 1]] };
    }
    return { rows: [] };
  }
}

describe('SnapshotRepo', () => {
  it('round-trips nquads, checksum, graph list and outbox watermark', async () => {
    const repo = new SnapshotRepo(new FakePool() as any);
    const saved = await repo.save(
      ['urn:sse:data', 'urn:sse:inferred', 'urn:sse:history'],
      '<a> <b> <c> <urn:sse:data> .\n',
      42,
    );
    expect(saved.version).toBe(1);
    expect(saved.graphNames).toEqual(['urn:sse:data', 'urn:sse:inferred', 'urn:sse:history']);
    expect(saved.lastOutboxId).toBe(42);
    const loaded = await repo.latest();
    expect(loaded?.checksum).toBe(saved.checksum);
    expect(loaded?.nquads).toContain('<a> <b> <c>');
    expect(loaded?.lastOutboxId).toBe(42);
  });
});
