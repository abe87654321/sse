import api from './index'

export interface GraphCounts {
  quads: number
  subjects: number
}

export interface OntologyStatus {
  engine?: string
  version: number
  counts: GraphCounts
  lagSeconds: number
  outboxPending: number
  deadLettered?: number
  outbox?: {
    pending: number
    deadLettered: number
    oldestPendingAgeSeconds: number
    lastError: string | null
  }
}

export interface OntologySchema {
  classes: string[]
  properties: string[]
}

export interface EntitySummary {
  uri: string
  type: string
  label?: string
  properties: Record<string, string>
}

export interface EntityDetail extends EntitySummary {
  relations: {
    outgoing: EntityRelation[]
    incoming: EntityRelation[]
  }
}

export interface EntityRelation {
  predicate: string
  target?: string
  source?: string
}

export interface NetworkNode extends EntitySummary {
  id?: string
  label?: string
}

export interface NetworkEdge {
  id: string
  from: string
  to: string
  predicate: string
  label: string
}

export interface NetworkResult {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
}

export interface GraphNode extends EntitySummary {
  id: string
  label: string
}

export interface OntologyGraphResponse {
  summary?: {
    total_nodes: number
    total_edges: number
    type_counts: Record<string, number>
  }
  graph?: { nodes: GraphNode[]; edges: NetworkEdge[] }
  nodes?: GraphNode[]
  edges?: NetworkEdge[]
}

export interface EntityQueryParams {
  type?: string
  status?: string
  department?: string
  q?: string
  page?: number
  pageSize?: number
}

export interface Evidence {
  code: string
  message: string
  evidence: string[]
}

export interface MatchedRule {
  id: string
  uri: string
  name: string
  min_amount: number
  max_amount: number
  amount_range: string
  approval_steps: number
  approval_chain: Array<{ role?: string; name?: string; [key: string]: unknown }>
}

export interface ValidationIssue extends Evidence {}

export interface ValidateResult {
  valid: boolean
  category: { id: string; name: string } | null
  matched_rule: MatchedRule | null
  issues: ValidationIssue[]
  suggestions: string[]
  source: 'graph' | 'db-fallback'
}

export interface TimelineEntry {
  at: string
  event: string
  actor?: string
  evidence: string
}

export interface WhyEntry extends Evidence {}

export interface Explanation {
  report: string
  timeline: TimelineEntry[]
  why: WhyEntry[]
  evidenceUris: string[]
}

export interface ImpactReport {
  uri: string
  serialNo: string
  amount: number
  status: string
  reason: string
}

export interface ImpactPerson {
  uri: string
  name: string
  department: string
}

export interface ImpactResult {
  affected_reports: ImpactReport[]
  affected_people: ImpactPerson[]
  counts: { reports: number; people: number; pending: number }
  hypothetical: boolean
}

export type AnomalyCode = 'amount_mismatch' | 'duplicate_invoice_no' | 'missing_approver'

export interface Anomaly {
  code: AnomalyCode
  severity: 'error' | 'warning' | 'info'
  message: string
  entities: string[]
  evidence: string[]
}

export interface AnomalySummary {
  total: number
  error: number
  warning: number
  info: number
  byCode: Record<string, number>
}

export interface AnomalyResult {
  anomalies: Anomaly[]
  summary: AnomalySummary
}

export interface AnomalyQueryParams {
  codes?: string
  limit?: number
}

function entityPath(uri: string): string {
  return `/ontology/entities/${encodeURIComponent(uri)}`
}

export const ontologyApi = {
  status: () => api.get<OntologyStatus>('/ontology/status'),
  schema: () => api.get<OntologySchema>('/ontology/schema'),
  graph: () => api.get<OntologyGraphResponse>('/ontology/graph'),
  entities: (params: EntityQueryParams = {}) => api.get('/ontology/entities', { params }),
  entity: (uri: string) => api.get<EntityDetail>(entityPath(uri)),
  network: (uri: string, depth: number, direction: string) =>
    api.get<NetworkResult>(`${entityPath(uri)}/network`, { params: { depth, direction } }),
  query: (body: unknown) => api.post('/ontology/query', body),
  validate: (body: unknown) => api.post<ValidateResult>('/ontology/validate', body),
  explain: (reportId: string) => api.post<Explanation>('/ontology/explain', { report_id: reportId }),
  impact: (body: unknown) => api.post<ImpactResult>('/ontology/impact', body),
  anomalies: (params: AnomalyQueryParams = {}) => api.get<AnomalyResult>('/ontology/anomalies', { params }),
  sparql: (query: string) => api.post('/ontology/sparql', { query }),
}

export default ontologyApi
