import { planItemSync } from '../item-sync';

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: 'cat-1',
    amount: 100,
    expenseDate: '2026-08-01',
    description: '住宿',
    ...overrides,
  };
}

describe('planItemSync', () => {
  it('updates incoming items that belong to the report', () => {
    const plan = planItemSync(['item-a'], [makeItem({ id: 'item-a' })]);

    expect(plan.updates.map((item) => item.id)).toEqual(['item-a']);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.deleteIds).toEqual([]);
  });

  it('deletes only existing items that are no longer in the payload', () => {
    const plan = planItemSync(['item-a', 'item-b'], [makeItem({ id: 'item-a' })]);

    expect(plan.updates).toHaveLength(1);
    expect(plan.deleteIds).toEqual(['item-b']);
  });

  it('inserts items without an id', () => {
    const plan = planItemSync([], [makeItem()]);

    expect(plan.inserts).toHaveLength(1);
    expect(plan.deleteIds).toEqual([]);
  });

  it('treats an unknown id as an insert instead of touching another report item', () => {
    const plan = planItemSync(['item-a'], [makeItem({ id: 'foreign-id' })]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.deleteIds).toEqual(['item-a']);
  });

  it('does not update the same existing item twice', () => {
    const plan = planItemSync(
      ['item-a'],
      [makeItem({ id: 'item-a' }), makeItem({ id: 'item-a', amount: 200 })],
    );

    expect(plan.updates).toHaveLength(1);
    expect(plan.inserts).toHaveLength(1);
  });
});
