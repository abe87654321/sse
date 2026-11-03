import { withTransaction } from '../transaction';

type FakeClient = {
  query: (sql: string) => Promise<void>;
  release: () => void;
};

function createPool(options: { onQuery?: (sql: string) => void } = {}) {
  const events: string[] = [];
  const client: FakeClient = {
    query: async (sql: string) => {
      events.push(sql);
      options.onQuery?.(sql);
    },
    release: () => {
      events.push('release');
    },
  };
  return {
    events,
    pool: { connect: async () => client },
  };
}

describe('withTransaction', () => {
  it('commits and returns the callback result on success', async () => {
    const { pool, events } = createPool();

    const result = await withTransaction(pool as any, async () => {
      events.push('work');
      return 42;
    });

    expect(result).toBe(42);
    expect(events).toEqual(['BEGIN', 'work', 'COMMIT', 'release']);
  });

  it('rolls back and rethrows when the callback fails', async () => {
    const { pool, events } = createPool();

    await expect(
      withTransaction(pool as any, async () => {
        events.push('work');
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(events).toEqual(['BEGIN', 'work', 'ROLLBACK', 'release']);
  });

  it('releases the client even if rollback fails', async () => {
    const { pool, events } = createPool({
      onQuery: (sql) => {
        if (sql === 'ROLLBACK') throw new Error('rollback failed');
      },
    });

    await expect(
      withTransaction(pool as any, async () => {
        throw new Error('original');
      })
    ).rejects.toThrow('original');

    expect(events).toEqual(['BEGIN', 'ROLLBACK', 'release']);
  });
});
