export interface SyncItemInput {
  id?: string;
  categoryId: string;
  amount: number;
  expenseDate: string;
  description?: string;
}

export interface SyncItemUpdate extends SyncItemInput {
  id: string;
}

export interface ItemSyncPlan {
  updates: SyncItemUpdate[];
  inserts: SyncItemInput[];
  deleteIds: string[];
}

export function planItemSync(existingIds: string[], items: SyncItemInput[]): ItemSyncPlan {
  const existing = new Set(existingIds);
  const kept = new Set<string>();
  const updates: SyncItemUpdate[] = [];
  const inserts: SyncItemInput[] = [];

  for (const item of items) {
    if (item.id && existing.has(item.id) && !kept.has(item.id)) {
      kept.add(item.id);
      updates.push({ ...item, id: item.id });
      continue;
    }

    const { id: _ignored, ...rest } = item;
    inserts.push(rest);
  }

  return {
    updates,
    inserts,
    deleteIds: existingIds.filter((id) => !kept.has(id)),
  };
}
