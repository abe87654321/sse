export interface OntologyEntity {
  uri: string
  type: string
  properties: Record<string, string>
}

export interface ExpenseExtraction {
  person?: { name: string; phone?: string; matchedUserId?: string }
  amount?: number
  category?: string
  categoryId?: string
  description?: string
  date?: string
}

export interface ActionResult {
  success: boolean
  partial?: boolean
  report_id?: string
  serial_no?: string
  approval_chain?: string[]
  explanation?: string
  error?: {
    step: string
    code: string
    detail: string
    suggestion?: string
  }
  notified: string[]
}

export interface GraphExtraction {
  entities: Array<{ uri: string; type: string; properties: Record<string, string> }>;
  relations: Array<{ from: string; to: string; predicate: string }>;
}

export { type ReasoningRule } from '@sse/shared';

export interface SparqlResult {
  results: Array<Record<string, string>>;
  count: number;
}
