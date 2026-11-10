import type { GraphStore } from './types';
import { OntologyQueryService } from '../query/query-service';

export interface PoolLike {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}

let store: GraphStore | null = null;
let poolRef: PoolLike | null = null;
let queryService: OntologyQueryService | null = null;

export function setGraphContext(nextStore: GraphStore, pool: PoolLike): void {
  store = nextStore;
  poolRef = pool;
  queryService = new OntologyQueryService(nextStore, pool);
}

export function getGraphStore(): GraphStore {
  if (!store) throw new Error('ontology graph is not initialized');
  return store;
}

export function getPool(): PoolLike {
  if (!poolRef) throw new Error('ontology pool is not initialized');
  return poolRef;
}

export function getQueryService(): OntologyQueryService {
  if (!queryService) throw new Error('ontology query service is not initialized');
  return queryService;
}
