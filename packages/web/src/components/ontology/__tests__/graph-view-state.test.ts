import { describe, expect, it } from 'vitest'
import {
  clearGraphViewState,
  DEFAULT_GRAPH_VIEW_STATE,
  GRAPH_VIEW_STATE_KEY,
  patchGraphViewState,
  readGraphViewState,
} from '../graph-view-state'

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>()

  get length(): number {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
}

describe('graph view state', () => {
  it('returns defaults when storage is empty', () => {
    const storage = new MemoryStorage()
    expect(readGraphViewState(storage)).toEqual(DEFAULT_GRAPH_VIEW_STATE)
  })

  it('round-trips filters, depth, viewport and selection', () => {
    const storage = new MemoryStorage()
    patchGraphViewState(
      {
        filters: { type: 'ExpenseReport', status: 'approved', department: '技术部', search: '差旅' },
        depth: 3,
        viewport: { scale: 1.4, position: { x: -120, y: 80 } },
        selectedUri: 'https://sse.local/report/1',
      },
      storage,
    )

    expect(readGraphViewState(storage)).toEqual({
      filters: { type: 'ExpenseReport', status: 'approved', department: '技术部', search: '差旅' },
      depth: 3,
      viewport: { scale: 1.4, position: { x: -120, y: 80 } },
      selectedUri: 'https://sse.local/report/1',
    })
  })

  it('merges partial updates instead of dropping existing fields', () => {
    const storage = new MemoryStorage()
    patchGraphViewState({ filters: { type: 'Person', status: '', department: '', search: '' } }, storage)
    patchGraphViewState({ selectedUri: 'https://sse.local/person/1' }, storage)

    const state = readGraphViewState(storage)
    expect(state.filters.type).toBe('Person')
    expect(state.selectedUri).toBe('https://sse.local/person/1')
  })

  it('falls back to defaults for corrupt JSON', () => {
    const storage = new MemoryStorage()
    storage.setItem(GRAPH_VIEW_STATE_KEY, '{not-json')
    expect(readGraphViewState(storage)).toEqual(DEFAULT_GRAPH_VIEW_STATE)
  })

  it('rejects invalid depth and viewport values', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      GRAPH_VIEW_STATE_KEY,
      JSON.stringify({ depth: 9, viewport: { scale: 0, position: { x: 1, y: 2 } } }),
    )

    const state = readGraphViewState(storage)
    expect(state.depth).toBe(2)
    expect(state.viewport).toBeNull()
  })

  it('clamps extreme zoom scales', () => {
    const storage = new MemoryStorage()
    patchGraphViewState({ viewport: { scale: 99, position: { x: 0, y: 0 } } }, storage)
    expect(readGraphViewState(storage).viewport?.scale).toBe(10)
  })

  it('clears persisted state', () => {
    const storage = new MemoryStorage()
    patchGraphViewState({ depth: 1 }, storage)
    clearGraphViewState(storage)
    expect(readGraphViewState(storage)).toEqual(DEFAULT_GRAPH_VIEW_STATE)
  })
})
