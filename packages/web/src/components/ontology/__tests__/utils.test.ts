import { describe, expect, it } from 'vitest'
import { entityLabel, selectVisibleGraphNodes, type GraphNodeLike } from '../utils'

function node(overrides: Partial<GraphNodeLike> & { uri: string }): GraphNodeLike {
  return { type: 'Person', properties: {}, ...overrides }
}

describe('entityLabel', () => {
  it('prefers human friendly properties over the raw graph label', () => {
    expect(
      entityLabel({
        uri: 'https://sse.local/person/p1',
        label: 'p1',
        properties: { title: '差旅报销', serialNo: 'RE-001', name: '张三' },
      }),
    ).toBe('差旅报销')

    expect(
      entityLabel({
        uri: 'https://sse.local/person/p1',
        label: 'p1',
        properties: { serialNo: 'RE-001', name: '张三' },
      }),
    ).toBe('RE-001')

    expect(
      entityLabel({
        uri: 'https://sse.local/person/p1',
        label: 'p1',
        properties: { name: '张三' },
      }),
    ).toBe('张三')
  })

  it('falls back to label and then the local URI name', () => {
    expect(
      entityLabel({ uri: 'https://sse.local/person/p1', label: 'preset-label', properties: {} }),
    ).toBe('preset-label')

    expect(entityLabel({ uri: 'https://sse.local/person/p1', properties: {} })).toBe('p1')
  })
})

describe('selectVisibleGraphNodes', () => {
  const nodes: GraphNodeLike[] = [
    node({ uri: 'https://sse.local/person/p0', type: 'Person', properties: { status: 'active' } }),
    node({ uri: 'https://sse.local/person/p1', type: 'Person', properties: { status: 'inactive' } }),
    node({ uri: 'https://sse.local/person/p2', type: 'Person', properties: { status: 'active' } }),
    node({ uri: 'https://sse.local/dept/d3', type: 'Department', properties: { status: 'active' } }),
    node({ uri: 'https://sse.local/dept/d4', type: 'Department', properties: { status: 'inactive' } }),
    node({ uri: 'https://sse.local/dept/d5', type: 'Department', properties: { status: 'active' } }),
  ]

  it('filters before applying the node cap', () => {
    const visible = selectVisibleGraphNodes(nodes, { type: 'Department' }, 2)

    expect(visible.map((item) => item.uri)).toEqual([
      'https://sse.local/dept/d3',
      'https://sse.local/dept/d4',
    ])
  })

  it('always keeps the selected node even when it would be capped out', () => {
    const visible = selectVisibleGraphNodes(nodes, { type: 'Department' }, 1, 'https://sse.local/dept/d5')

    expect(visible.map((item) => item.uri)).toEqual([
      'https://sse.local/dept/d3',
      'https://sse.local/dept/d5',
    ])
  })

  it('matches free-text searches against ids, labels, types and properties', () => {
    const visible = selectVisibleGraphNodes(
      [{ ...nodes[0], label: 'Alice' }, ...nodes.slice(1)],
      { term: 'alice' },
      10,
    )

    expect(visible.map((item) => item.uri)).toEqual(['https://sse.local/person/p0'])
  })
})
