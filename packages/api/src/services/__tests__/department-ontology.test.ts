import {
  MemoryGraphStore,
  OwlStore,
  projectRow,
  sse,
  uri,
  type GraphStore,
} from '@sse/ontology';
import {
  applyDepartmentChangeToGraph,
  applyDepartmentChangeToLegacy,
} from '../department-ontology';

const LEGACY_BASE = 'https://sse.local';
const person = 'https://sse.local/person/u1';
const oldDept = `${LEGACY_BASE}/dept/旧部`;
const newDept = `${LEGACY_BASE}/dept/新部`;

async function seedV2(store: GraphStore): Promise<void> {
  const projection = projectRow('users', 'INSERT', {
    id: 'u1',
    name: 'Alice',
    role: 'employee',
    status: 'active',
    department: '旧部',
    deleted_at: null,
  });
  for (const write of projection.writes) {
    await store.replaceEntity(write.uri, write.quads, write.ownedPredicates);
  }
  for (const relation of projection.add) {
    await store.addRelation(relation.from, relation.predicate, relation.to);
  }
}

async function countSubject(store: GraphStore, subject: string): Promise<number> {
  const result = await store.query(
    `SELECT (COUNT(*) AS ?count) WHERE { GRAPH <urn:sse:data> { <${subject}> ?p ?o } }`
  );
  if (result.kind !== 'select') return 0;
  return Number(result.rows[0]?.count ?? 0);
}

async function personValues(
  store: GraphStore,
  predicate: string
): Promise<string[]> {
  const result = await store.query(
    `SELECT ?o WHERE { GRAPH <urn:sse:data> { <${person}> <${sse(predicate)}> ?o } }`
  );
  if (result.kind !== 'select') return [];
  return result.rows.map((row) => row.o);
}

describe('applyDepartmentChangeToLegacy', () => {
  it('creates a department entity', () => {
    const store = new OwlStore();
    applyDepartmentChangeToLegacy(store, { action: 'create', name: '新部' });

    expect(store.queryByType('Department').map((entry) => entry.uri)).toEqual([newDept]);
  });

  it('moves users to the renamed department and deletes the old entity', () => {
    const store = new OwlStore();
    store.addEntity(oldDept, 'Department', { name: '旧部' });
    store.addEntity(person, 'Person', { name: 'Alice', department: '旧部' });
    store.addRelation(person, 'sse:belongsTo', oldDept);

    applyDepartmentChangeToLegacy(store, {
      action: 'rename',
      name: '新部',
      previousName: '旧部',
      users: [{ id: 'u1' }],
    });

    expect(store.query(person, sse('department'), '新部')).toHaveLength(1);
    expect(store.query(person, 'sse:belongsTo', newDept)).toHaveLength(1);
    expect(store.query(person, 'sse:belongsTo', oldDept)).toHaveLength(0);
    expect(store.queryByType('Department').map((entry) => entry.uri)).toEqual([newDept]);
  });

  it('deletes a department entity', () => {
    const store = new OwlStore();
    store.addEntity(newDept, 'Department', { name: '新部' });

    applyDepartmentChangeToLegacy(store, { action: 'delete', name: '新部' });

    expect(store.queryByType('Department')).toHaveLength(0);
  });
});

describe('applyDepartmentChangeToGraph', () => {
  it('creates a department entity in the v2 graph', async () => {
    const store = new MemoryGraphStore();
    await applyDepartmentChangeToGraph(store, { action: 'create', name: '新部' });

    expect(await countSubject(store, uri.department('新部'))).toBeGreaterThan(0);
  });

  it('re-projects users and removes the previous department subject', async () => {
    const store = new MemoryGraphStore();
    await seedV2(store);

    await applyDepartmentChangeToGraph(store, {
      action: 'rename',
      name: '新部',
      previousName: '旧部',
      users: [
        {
          id: 'u1',
          name: 'Alice',
          role: 'employee',
          status: 'active',
          department: '旧部',
          deleted_at: null,
        },
      ],
    });

    expect(await personValues(store, 'department')).toEqual(['新部']);
    expect(await personValues(store, 'belongsTo')).toEqual([uri.department('新部')]);
    expect(await countSubject(store, uri.department('旧部'))).toBe(0);
    expect(await countSubject(store, uri.department('新部'))).toBeGreaterThan(0);
  });

  it('deletes a department subject without touching users', async () => {
    const store = new MemoryGraphStore();
    await applyDepartmentChangeToGraph(store, { action: 'create', name: '新部' });

    await applyDepartmentChangeToGraph(store, { action: 'delete', name: '新部' });

    expect(await countSubject(store, uri.department('新部'))).toBe(0);
  });
});
