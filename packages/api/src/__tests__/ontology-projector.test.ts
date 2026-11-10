import { ProjectorRunner } from '../services/ontology-projector';

const result = { processed: 1, failed: 0, deadLettered: 0 };

describe('ProjectorRunner', () => {
  it('drains and sleeps until stopped', async () => {
    const calls: string[] = [];
    const runner = new ProjectorRunner({
      drain: async () => { calls.push('drain'); return result; },
      purgeOldEvents: async () => 0,
      snapshot: async () => {},
      runRules: async () => {},
      needsRebuild: () => false,
      reconcile: async () => { calls.push('reconcile'); },
    } as any, { intervalMs: 5, snapshotEvery: 2 });

    runner.start();
    await new Promise(resolve => setTimeout(resolve, 30));
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
      needsRebuild: () => true,
      reconcile: async () => { calls.push('reconcile'); },
    } as any, { intervalMs: 1000, snapshotEvery: 5 });

    await (runner as any).tick();
    await runner.stop();

    expect(calls).toEqual(['reconcile', 'drain']);
    errorSpy.mockRestore();
  });

  it('does not require runRules', async () => {
    const calls: string[] = [];
    const runner = new ProjectorRunner({
      drain: async () => { calls.push('drain'); return result; },
      purgeOldEvents: async () => 0,
      snapshot: async () => {},
      needsRebuild: () => false,
      reconcile: async () => {},
    } as any, { intervalMs: 1000, snapshotEvery: 1 });

    await expect((runner as any).tick()).resolves.toBeUndefined();
    await runner.stop();

    expect(calls).toEqual(['drain']);
  });

  it('snapshots after the configured number of successful ticks', async () => {
    let snapshots = 0;
    const runner = new ProjectorRunner({
      drain: async () => result,
      purgeOldEvents: async () => 0,
      snapshot: async () => { snapshots += 1; },
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
      needsRebuild: () => false,
      reconcile: async () => {},
    } as any, { intervalMs: 1000, snapshotEvery: 5 });

    await (runner as any).tick();
    await (runner as any).tick();

    expect(purges).toBe(1);
    await runner.stop();
  });
});
