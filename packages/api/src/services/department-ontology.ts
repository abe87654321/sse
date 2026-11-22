import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import {
  GRAPH,
  RDF_TYPE,
  getGraphStore,
  projectRow,
  sse,
  uri,
  type GraphStore,
  type OwlStore,
} from '@sse/ontology';
import { getEngine } from '../routes/ontology-helpers';

export interface DepartmentChangeUser {
  id: string;
  name?: string;
  role?: string;
  status?: string;
  deleted_at?: string | Date | null;
  department?: string;
}

export interface DepartmentChange {
  action: 'create' | 'rename' | 'delete';
  name: string;
  previousName?: string;
  users?: DepartmentChangeUser[];
}

const LEGACY_BASE = 'https://sse.local';
const legacyDeptUri = (name: string) => `${LEGACY_BASE}/dept/${name}`;
const legacyPersonUri = (id: string) => `${LEGACY_BASE}/person/${id}`;

export function applyDepartmentChangeToLegacy(
  store: OwlStore,
  change: DepartmentChange
): void {
  const target = legacyDeptUri(change.name);

  if (change.action === 'delete') {
    store.deleteEntity(target);
    return;
  }

  store.addEntity(target, 'Department', { name: change.name });

  if (change.action !== 'rename' || !change.previousName) return;
  if (change.previousName === change.name) return;

  const previous = legacyDeptUri(change.previousName);
  for (const user of change.users ?? []) {
    const person = legacyPersonUri(user.id);
    store.deleteRelation(person, 'sse:belongsTo', previous);
    store.addRelation(person, 'sse:belongsTo', target);
    store.setProperty(person, 'department', change.name);
  }
  store.deleteEntity(previous);
}

export async function applyDepartmentChangeToGraph(
  store: GraphStore,
  change: DepartmentChange
): Promise<void> {
  if (change.action === 'delete') {
    await store.deleteSubject(uri.department(change.name));
    return;
  }

  const target = uri.department(change.name);
  await store.replaceEntity(
    target,
    [
      {
        subject: target,
        predicate: RDF_TYPE,
        object: sse('Department'),
        objectType: 'iri',
        graph: GRAPH.data,
      },
      {
        subject: target,
        predicate: sse('name'),
        object: change.name,
        objectType: 'literal',
        graph: GRAPH.data,
      },
    ],
    [RDF_TYPE, sse('name')]
  );

  if (change.action !== 'rename' || !change.previousName) return;
  if (change.previousName === change.name) return;

  for (const user of change.users ?? []) {
    const projection = projectRow('users', 'UPDATE', {
      ...user,
      department: change.name,
    });
    for (const write of projection.writes) {
      await store.replaceEntity(write.uri, write.quads, write.ownedPredicates);
    }
    for (const relation of projection.add) {
      await store.addRelation(relation.from, relation.predicate, relation.to);
    }
    for (const relation of projection.remove) {
      await store.removeRelation(relation.from, relation.predicate, relation.to);
    }
  }

  await store.deleteSubject(uri.department(change.previousName));
}

async function persistLegacy(store: OwlStore): Promise<void> {
  await store.saveToDb().catch(() => {});
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
  } catch {
    /* best effort */
  }
}

export async function syncDepartmentChange(change: DepartmentChange): Promise<void> {
  try {
    const engine = getEngine();
    applyDepartmentChangeToLegacy(engine.store, change);
    await persistLegacy(engine.store);
  } catch {
    /* ontology sync is best-effort */
  }

  if (process.env.ONTOLOGY_V2 !== 'on' && process.env.ONTOLOGY_V2 !== 'shadow') return;
  try {
    await applyDepartmentChangeToGraph(getGraphStore(), change);
  } catch {
    /* graph may not be initialized */
  }
}
