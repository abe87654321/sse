import { describe, expect, it } from 'vitest'
import {
  entityLabel,
  isOpaqueIdentifier,
  selectVisibleGraphNodes,
  type GraphNodeLike,
} from '../utils'

const UUID = '3f2a1b9c-8d7e-4f6a-9b0c-1d2e3f4a5b6c'
const CHECKSUM = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

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

  it('prefers meaningful properties over an opaque backend label', () => {
    expect(
      entityLabel({
        uri: `https://sse.local/item/${UUID}`,
        label: UUID,
        properties: { description: '住宿费', amount: '100' },
      }),
    ).toBe('住宿费')

    expect(
      entityLabel({
        uri: `https://sse.local/item/${UUID}`,
        label: `item/${UUID}`,
        properties: { category: '住宿' },
      }),
    ).toBe('住宿')
  })

  it('hides UUID file names that carry no human meaning', () => {
    expect(
      entityLabel({
        uri: `https://sse.local/payment/${UUID}`,
        label: UUID,
        properties: { fileName: `${UUID}.pdf`, checksum: CHECKSUM },
      }),
    ).toBe('')
  })

  it('keeps readable file names and invoice numbers', () => {
    expect(
      entityLabel({
        uri: `https://sse.local/payment/${UUID}`,
        label: UUID,
        properties: { fileName: 'review-receipt.png' },
      }),
    ).toBe('review-receipt.png')

    expect(
      entityLabel({
        uri: `https://sse.local/invoice/${UUID}`,
        label: UUID,
        properties: { invoiceNo: 'INV-2026-001' },
      }),
    ).toBe('INV-2026-001')
  })
})

describe('isOpaqueIdentifier', () => {
  it('detects UUIDs, URI ids, checksums and long keys', () => {
    expect(isOpaqueIdentifier(UUID)).toBe(true)
    expect(isOpaqueIdentifier(`item/${UUID}`)).toBe(true)
    expect(isOpaqueIdentifier(CHECKSUM)).toBe(true)
    expect(isOpaqueIdentifier('a1b2c3d4e5f6g7h8i9j0k1l2')).toBe(true)
  })

  it('keeps human readable values', () => {
    expect(isOpaqueIdentifier('RE-20261111-535')).toBe(false)
    expect(isOpaqueIdentifier('住宿费')).toBe(false)
    expect(isOpaqueIdentifier('INV-2026-001')).toBe(false)
    expect(isOpaqueIdentifier('review-receipt.png')).toBe(false)
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
