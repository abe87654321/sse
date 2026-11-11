import {
  ProjectorRunner,
  logShadowReport,
  maxOutboxBatch,
  outboxRetentionDays,
  shadowSampleRows,
} from '../services/ontology-projector';

const result = { processed: 1, failed: 0, deadLettered: 0 };

describe('ProjectorRunner', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('drains and sleeps until stopped', async () => {
    const calls: string[] = [];
    const runner = new ProjectorRunner({
      drain: async () => { calls.push('drain'); return result; },
      purgeOldEvents: async () => 0,
      snapshot: async () => {},
      runRules: async () => 1,
      needsRebuild: () => false,
      reconcile: async () => { calls.push('reconcile'); },
    } as any, { intervalMs: 5, snapshotEvery: 2 });

    jest.useFakeTimers();
    runner.start();
    await jest.advanceTimersByTimeAsync(30);
    await runner.stop();

    expect(calls.filter(call => call === 'drain').length).toBeGreaterThan(1);
  });

  it('reconciles when the worker reports it needs a rebuild', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const calls: string[] = [];
    const runner = new ProjectorRunner({
      drain: async () => { calls.push('drain'); return result; },
      purgeOldEvents: async () => 0,
      snapshot: async () => {},
      runRules: async () => 1,
      needsRebuild: () => true,
      reconcile: async () => { calls.push('reconcile'); },
    } as any, { intervalMs: 1000, snapshotEvery: 5 });

    await (runner as any).tick();
    await runner.stop();

    expect(calls).toEqual(['reconcile', 'drain']);
    errorSpy.mockRestore();
  });

  it('materializes rules after a processed batch', async () => {
    const calls: string[] = [];
    const runner = new ProjectorRunner({
      drain: async () => { calls.push('drain'); return result; },
      purgeOldEvents: async () => 0,
      snapshot: async () => {},
      runRules: async () => { calls.push('rules'); return 1; },
      needsRebuild: () => false,
      reconcile: async () => {},
    } as any, { intervalMs: 1000, snapshotEvery: 1 });

    await expect((runner as any).tick()).resolves.toBeUndefined();
    await runner.stop();

    expect(calls).toEqual(['drain', 'rules']);
  });

  it('snapshots after the configured number of successful ticks', async () => {
    let snapshots = 0;
    const runner = new ProjectorRunner({
      drain: async () => result,
      purgeOldEvents: async () => 0,
      snapshot: async () => { snapshots += 1; },
      runRules: async () => 1,
      needsRebuild: () => false,
      reconcile: async () => {},
    } as any, { intervalMs: 1000, snapshotEvery: 2 });

    await (runner as any).tick();
    expect(snapshots).toBe(0);
    await (runner as any).tick();
    expect(snapshots).toBe(1);
  });

  it('serializes ticks and waits for the in-flight drain before the final snapshot', async () => {
    let active = 0;
    let maxActive = 0;
    let drains = 0;
    let snapshotSawActive = -1;
    const runner = new ProjectorRunner({
      drain: async () => {
        drains += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 50));
        active -= 1;
        return result;
      },
      purgeOldEvents: async () => 0,
      snapshot: async () => { snapshotSawActive = active; },
      runRules: async () => 1,
      needsRebuild: () => false,
      reconcile: async () => {},
    } as any, { intervalMs: 5, snapshotEvery: 100 });

    runner.start();
    await new Promise(resolve => setTimeout(resolve, 130));
    await runner.stop();

    expect(drains).toBeGreaterThan(1);
    expect(maxActive).toBe(1);
    expect(snapshotSawActive).toBe(0);
  });

  it('skips a tick when one is already running', async () => {
    let drains = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const runner = new ProjectorRunner({
      drain: async () => {
        drains += 1;
        await gate;
        return result;
      },
      purgeOldEvents: async () => 0,
      snapshot: async () => {},
      runRules: async () => 1,
      needsRebuild: () => false,
      reconcile: async () => {},
    } as any, { intervalMs: 1000, snapshotEvery: 5 });

    const first = (runner as any).tick();
    await expect((runner as any).tick()).resolves.toBeUndefined();
    expect(drains).toBe(1);

    release();
    await first;
    await runner.stop();
  });

  it('purges old events at most once per hour', async () => {
    let purges = 0;
    const runner = new ProjectorRunner({
      drain: async () => result,
      purgeOldEvents: async () => { purges += 1; return 0; },
      snapshot: async () => {},
      runRules: async () => 1,
      needsRebuild: () => false,
      reconcile: async () => {},
    } as any, { intervalMs: 1000, snapshotEvery: 5 });

    await (runner as any).tick();
    await (runner as any).tick();

    expect(purges).toBe(1);
    await runner.stop();
  });
});

describe('shadow logging', () => {
  it('writes aggregate counts to stderr without row values', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    logShadowReport({
      equal: false,
      checkedAt: '2026-11-10T12:00:00.000Z',
      differences: [
        {
          kind: 'row',
          table: 'invoices',
          id: '00000000-0000-0000-0000-0000000000aa',
          sql: { file_name: 'secret-invoice.pdf' },
          graph: { fileName: null },
        },
        {
          kind: 'relation',
          table: 'expense_reports',
          sql: 3,
          graph: 1,
        },
      ],
    });

    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain('[ontology-shadow]');
    expect(line).not.toContain('secret-invoice.pdf');
    expect(line).not.toContain('00000000-0000-0000-0000-0000000000aa');
    expect(line).toContain('"differences":2');
    expect(line).toContain('"row":1');
    expect(line).toContain('"invoices":1');

    errorSpy.mockRestore();
  });
});

describe('projector env settings', () => {
  const keys = [
    'ONTOLOGY_MAX_OUTBOX_BATCH',
    'ONTOLOGY_OUTBOX_RETENTION_DAYS',
    'ONTOLOGY_SHADOW_SAMPLE_ROWS',
  ] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('honors ONTOLOGY_MAX_OUTBOX_BATCH', () => {
    process.env.ONTOLOGY_MAX_OUTBOX_BATCH = '37';
    expect(maxOutboxBatch()).toBe(37);

    process.env.ONTOLOGY_MAX_OUTBOX_BATCH = '0';
    expect(maxOutboxBatch()).toBe(200);
  });

  it('honors ONTOLOGY_OUTBOX_RETENTION_DAYS', () => {
    process.env.ONTOLOGY_OUTBOX_RETENTION_DAYS = '14';
    expect(outboxRetentionDays()).toBe(14);

    process.env.ONTOLOGY_OUTBOX_RETENTION_DAYS = '';
    expect(outboxRetentionDays()).toBe(7);
  });

  it('honors ONTOLOGY_SHADOW_SAMPLE_ROWS', () => {
    process.env.ONTOLOGY_SHADOW_SAMPLE_ROWS = '50';
    expect(shadowSampleRows()).toBe(50);

    process.env.ONTOLOGY_SHADOW_SAMPLE_ROWS = '5000';
    expect(shadowSampleRows()).toBe(1000);
  });
});
