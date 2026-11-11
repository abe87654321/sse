import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('../index', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
  },
}))

import { ontologyApi } from '../ontology'

const REPORT_URI = 'https://sse.local/report/r1'
const ENCODED_REPORT_URI = encodeURIComponent(REPORT_URI)

describe('ontologyApi', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
  })

  it('maps status and schema GET requests', () => {
    ontologyApi.status()
    ontologyApi.schema()

    expect(mocks.get).toHaveBeenNthCalledWith(1, '/ontology/status')
    expect(mocks.get).toHaveBeenNthCalledWith(2, '/ontology/schema')
  })

  it('maps the graph request', () => {
    ontologyApi.graph()
    expect(mocks.get).toHaveBeenCalledWith('/ontology/graph')
  })

  it('maps entity list query params', () => {
    ontologyApi.entities({ type: 'ExpenseReport', status: 'pending', page: 2, pageSize: 50 })

    expect(mocks.get).toHaveBeenCalledWith('/ontology/entities', {
      params: { type: 'ExpenseReport', status: 'pending', page: 2, pageSize: 50 },
    })
  })

  it('encodes the entity URI', () => {
    ontologyApi.entity(REPORT_URI)
    expect(mocks.get).toHaveBeenCalledWith(`/ontology/entities/${ENCODED_REPORT_URI}`)
  })

  it('maps network depth and direction params', () => {
    ontologyApi.network(REPORT_URI, 3, 'out')

    expect(mocks.get).toHaveBeenCalledWith(
      `/ontology/entities/${ENCODED_REPORT_URI}/network`,
      { params: { depth: 3, direction: 'out' } },
    )
  })

  it('maps typed query and validation POST bodies', () => {
    const query = { department: '研发', status: 'pending' }
    const validation = { amount: 1200, category: 'travel' }

    ontologyApi.query(query)
    ontologyApi.validate(validation)

    expect(mocks.post).toHaveBeenNthCalledWith(1, '/ontology/query', query)
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/ontology/validate', validation)
  })

  it('maps explain to report_id', () => {
    ontologyApi.explain('r1')
    expect(mocks.post).toHaveBeenCalledWith('/ontology/explain', { report_id: 'r1' })
  })

  it('maps impact body', () => {
    const body = { rule_id: 'rule-1', amount_delta: 100 }
    ontologyApi.impact(body)
    expect(mocks.post).toHaveBeenCalledWith('/ontology/impact', body)
  })

  it('maps anomaly filters', () => {
    ontologyApi.anomalies({ codes: 'amount_mismatch,missing_approver', limit: 10 })
    expect(mocks.get).toHaveBeenCalledWith('/ontology/anomalies', {
      params: { codes: 'amount_mismatch,missing_approver', limit: 10 },
    })
  })

  it('maps sparql query body', () => {
    ontologyApi.sparql('SELECT * WHERE { ?s ?p ?o }')
    expect(mocks.post).toHaveBeenCalledWith('/ontology/sparql', {
      query: 'SELECT * WHERE { ?s ?p ?o }',
    })
  })
})
