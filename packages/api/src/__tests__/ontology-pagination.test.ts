import {
  type EntityListInput,
  LIST_ALL_MAX_PAGES,
  LIST_ALL_MAX_ROWS,
  listAllEntities,
} from '../routes/ontology-pagination';

function pageValues(input: EntityListInput) {
  return { page: input.page ?? 1, pageSize: input.pageSize ?? 1000 };
}

function fakeService(total: number) {
  const rows = Array.from({ length: total }, (_, index) => ({
    uri: `https://sse.local/item/${index}`,
    properties: { index },
  }));
  const calls: Array<{ page: number; pageSize: number }> = [];
  return {
    calls,
    async listEntities(input: EntityListInput) {
      const { page, pageSize } = pageValues(input);
      calls.push({ page, pageSize });
      const start = (page - 1) * pageSize;
      return { results: rows.slice(start, start + pageSize), total };
    },
  };
}

describe('listAllEntities', () => {
  it('returns all 1001 rows across pages', async () => {
    const service = fakeService(1001);

    const result = await listAllEntities(service, {
      type: 'Item',
      scope: { kind: 'all' },
    });

    expect(result.results).toHaveLength(1001);
    expect(result.total).toBe(1001);
    expect(result.truncated).toBe(false);
    expect(service.calls).toHaveLength(2);
    expect(service.calls[0]).toEqual({ page: 1, pageSize: 1000 });
    expect(service.calls[1]).toEqual({ page: 2, pageSize: 1000 });
    expect(result.results[1000].uri).toBe('https://sse.local/item/1000');
  });

  it('stops at the safety cap and warns about truncation', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let pages = 0;
    const service = {
      async listEntities(input: EntityListInput) {
        pages += 1;
        const { page, pageSize } = pageValues(input);
        const start = (page - 1) * pageSize;
        const results = Array.from({ length: pageSize }, (_, index) => ({
          uri: `https://sse.local/item/${start + index}`,
          properties: {},
        }));
        return { results, total: 1_000_000 };
      },
    };

    try {
      const result = await listAllEntities(service, {
        type: 'Item',
        scope: { kind: 'all' },
      });

      expect(pages).toBe(LIST_ALL_MAX_PAGES);
      expect(result.results).toHaveLength(LIST_ALL_MAX_ROWS);
      expect(result.total).toBe(1_000_000);
      expect(result.truncated).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('truncated');
      expect(warn.mock.calls[0][0]).toContain(`${LIST_ALL_MAX_ROWS}/1000000`);
    } finally {
      warn.mockRestore();
    }
  });
});
