import { MemoryGraphStore } from '../graph/memory-store';
import { projectRow, type MappedTable } from '../projection/entity-mapper';
import { compareShadow, graphRelationCount, type ShadowPool } from '../projection/shadow';

const U1 = '00000000-0000-0000-0000-000000000001';
const C1 = '00000000-0000-0000-0000-000000000002';
const R1 = '00000000-0000-0000-0000-000000000003';
const I1 = '00000000-0000-0000-0000-000000000004';
const V1 = '00000000-0000-0000-0000-000000000005';
const A1 = '00000000-0000-0000-0000-000000000006';
const AP1 = '00000000-0000-0000-0000-000000000007';
const P1 = '00000000-0000-0000-0000-000000000008';

const DB: Record<string, any[]> = {
  users: [
    {
      id: U1,
      name: 'Alice',
      department: '技术部',
      role: 'employee',
      status: 'active',
      deleted_at: null,
    },
  ],
  expense_categories: [
    { id: C1, name: '差旅', sort_order: 1, is_active: true },
  ],
  expense_reports: [
    {
      id: R1,
      user_id: U1,
      serial_no: 'RE-1',
      title: '出差',
      total_amount: '10.00',
      status: 'pending',
      current_step: 1,
      submitted_at: '2026-11-10T00:00:00Z',
      completed_at: null,
      paid_at: null,
      payment_ref: null,
    },
  ],
  expense_items: [
    {
      id: I1,
      report_id: R1,
      category_id: C1,
      amount: '10.00',
      expense_date: '2026-11-10',
      description: '打车',
    },
  ],
  invoices: [
    {
      id: V1,
      item_id: I1,
      invoice_no: 'INV-1',
      verification_status: 'pending',
      file_name: 'a.pdf',
      checksum: 'abc',
      uploaded_at: '2026-11-10T01:00:00Z',
    },
  ],
  approval_rules: [
    {
      id: A1,
      name: '默认审批规则',
      min_amount: '0.00',
      max_amount: '1000.00',
      priority: 1,
      is_active: true,
      approval_chain: { step: 1, role: 'finance' },
    },
  ],
  approval_records: [
    {
      id: AP1,
      report_id: R1,
      step: 1,
      result: 'pending',
      comment: null,
      step_started_at: '2026-11-10T02:00:00Z',
      approved_at: null,
    },
  ],
  payment_receipts: [
    {
      id: P1,
      report_id: R1,
      verification_status: 'pending',
      file_name: 'receipt.pdf',
      checksum: 'def',
      uploaded_at: '2026-11-10T03:00:00Z',
    },
  ],
};

class FakeShadowPool implements ShadowPool {
  readonly calls: Array<{ sql: string; params: any[] }> = [];

  constructor(private readonly data: Record<string, any[]>) {}

  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    const statement = sql.replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: statement, params });

    const group = /FROM (\w+) WHERE (\w+) IS NOT NULL GROUP BY/.exec(statement);
    if (group) {
      const [, table, column] = group;
      const counts = new Map<string, number>();
      for (const row of this.data[table] ?? []) {
        if (row[column] === null || row[column] === undefined) continue;
        const value = statement.includes('deleted_at IS NOT NULL')
          ? row.deleted_at
            ? 'deleted'
            : row.status
          : row[column];
        counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      }
      return {
        rows: [...counts.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([value, count]) => ({ value, count })),
      };
    }

    const relation = /FROM (\w+) WHERE (\w+) IS NOT NULL/.exec(statement);
    if (relation) {
      const [, table, column] = relation;
      const rows = this.data[table] ?? [];
      return {
        rows: [{
          count: rows.filter((row) => row[column] !== null && row[column] !== undefined).length,
        }],
      };
    }

    const table = Object.keys(this.data).find((name) => statement.includes(`FROM ${name}`));
    if (!table) return { rows: [] };
    const rows = this.data[table] ?? [];

    if (statement.includes('WHERE id > $1')) {
      const lastId = String(params[0] ?? '');
      const limit = Number(params[1] ?? rows.length);
      return {
        rows: rows
          .filter((row) => String(row.id) > lastId)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
          .slice(0, limit),
      };
    }

    if (/^SELECT COUNT\(\*\)::int AS count FROM \w+$/.test(statement)) {
      return { rows: [{ count: rows.length }] };
    }

    return { rows: [] };
  }
}

async function buildGraph(data: Record<string, any[]>, skipTable?: MappedTable): Promise<MemoryGraphStore> {
  const store = new MemoryGraphStore();
  for (const [table, rows] of Object.entries(data)) {
    if (table === skipTable) continue;
    for (const row of rows) {
      const projection = projectRow(table as MappedTable, 'INSERT', row);
      for (const write of projection.writes) {
        await store.replaceEntity(write.uri, write.quads, write.ownedPredicates);
      }
      for (const relation of projection.add) {
        await store.addRelation(relation.from, relation.predicate, relation.to);
      }
    }
  }
  return store;
}

describe('compareShadow', () => {
  it('reports equality when the graph is projected from the same SQL rows', async () => {
    const store = await buildGraph(DB);
    const report = await compareShadow(store, new FakeShadowPool(DB));

    expect(report.equal).toBe(true);
    expect(report.differences).toEqual([]);
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('detects missing rows, values, statuses and relations', async () => {
    const store = await buildGraph(DB, 'expense_reports');
    const report = await compareShadow(store, new FakeShadowPool(DB));

    expect(report.equal).toBe(false);
    expect(report.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'count',
          table: 'expense_reports',
          sql: 1,
          graph: 0,
        }),
        expect.objectContaining({
          kind: 'row',
          table: 'expense_reports',
          id: R1,
        }),
        expect.objectContaining({
          kind: 'status',
          table: 'expense_reports',
        }),
        expect.objectContaining({
          kind: 'relation',
          table: 'expense_reports',
          sql: 1,
          graph: 0,
        }),
      ]),
    );
  });

  it('matches one-to-many relation counts exactly like SQL', async () => {
    const items = [1, 2, 3].map((index) => ({
      id: `00000000-0000-0000-0000-00000000001${index}`,
      report_id: R1,
      category_id: C1,
      amount: '10.00',
      expense_date: '2026-11-10',
      description: `item ${index}`,
    }));
    const data = {
      ...DB,
      expense_items: items,
      invoices: [],
      approval_records: [],
      payment_receipts: [],
    };
    const store = await buildGraph(data);
    const pool = new FakeShadowPool(data);

    const report = await compareShadow(store, pool);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM expense_items WHERE report_id IS NOT NULL',
    );

    expect(Number(rows[0].count)).toBe(3);
    expect(await graphRelationCount(store, 'containsItem')).toBe(3);
    expect(report.equal).toBe(true);
    expect(report.differences).toEqual([]);
  });

  it('samples at most the configured number of rows per table', async () => {
    const categories = Array.from({ length: 5 }, (_, index) => ({
      id: `00000000-0000-0000-0000-00000000002${index}`,
      name: `category ${index}`,
      sort_order: index,
      is_active: true,
    }));
    const data = { ...DB, expense_categories: categories };
    const store = await buildGraph(data);
    const pool = new FakeShadowPool(data);

    const report = await compareShadow(store, pool, { sampleSize: 2 });

    expect(report.equal).toBe(true);
    const categorySamples = pool.calls.filter((call) =>
      call.sql.includes('FROM expense_categories WHERE id > $1'),
    );
    expect(categorySamples).toHaveLength(1);
    expect(categorySamples[0].params[1]).toBe(2);
  });

  it('uses an injectable clock for checkedAt', async () => {
    const store = await buildGraph(DB);
    const fixed = new Date('2026-11-10T12:34:56.000Z');
    const report = await compareShadow(store, new FakeShadowPool(DB), {
      now: () => fixed,
    });

    expect(report.checkedAt).toBe(fixed.toISOString());
  });
});
