export const GRAPH_VIEW_STATE_KEY = 'sse:ontology-graph:v1'

export interface GraphViewFilters {
  type: string
  status: string
  department: string
  search: string
}

export interface GraphViewport {
  scale: number
  position: { x: number; y: number }
}

export interface GraphViewState {
  filters: GraphViewFilters
  depth: number
  viewport: GraphViewport | null
  selectedUri: string | null
}

export const DEFAULT_GRAPH_VIEW_STATE: GraphViewState = {
  filters: { type: '', status: '', department: '', search: '' },
  depth: 2,
  viewport: null,
  selectedUri: null,
}

function defaultState(): GraphViewState {
  return {
    filters: { ...DEFAULT_GRAPH_VIEW_STATE.filters },
    depth: DEFAULT_GRAPH_VIEW_STATE.depth,
    viewport: null,
    selectedUri: null,
  }
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asDepth(value: unknown): number {
  return value === 1 || value === 2 || value === 3 ? value : DEFAULT_GRAPH_VIEW_STATE.depth
}

function asSelectedUri(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asViewport(value: unknown): GraphViewport | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const { scale } = candidate
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null

  const position = candidate.position
  if (!position || typeof position !== 'object') return null
  const { x, y } = position as Record<string, unknown>
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  if (typeof y !== 'number' || !Number.isFinite(y)) return null

  return {
    scale: Math.min(Math.max(scale, 0.02), 10),
    position: { x, y },
  }
}

export function readGraphViewState(storage?: Storage | null): GraphViewState {
  const target = resolveStorage(storage)
  if (!target) return defaultState()

  try {
    const raw = target.getItem(GRAPH_VIEW_STATE_KEY)
    if (!raw) return defaultState()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaultState()

    const source = parsed as Record<string, unknown>
    const filters = source.filters
    const filterSource =
      filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : {}

    return {
      filters: {
        type: asString(filterSource.type),
        status: asString(filterSource.status),
        department: asString(filterSource.department),
        search: asString(filterSource.search),
      },
      depth: asDepth(source.depth),
      viewport: asViewport(source.viewport),
      selectedUri: asSelectedUri(source.selectedUri),
    }
  } catch {
    return defaultState()
  }
}

export function patchGraphViewState(
  patch: Partial<GraphViewState>,
  storage?: Storage | null,
): void {
  const target = resolveStorage(storage)
  if (!target) return

  const current = readGraphViewState(target)
  const next: GraphViewState = {
    filters: { ...current.filters, ...(patch.filters ?? {}) },
    depth: patch.depth !== undefined ? asDepth(patch.depth) : current.depth,
    viewport: patch.viewport !== undefined ? asViewport(patch.viewport) : current.viewport,
    selectedUri:
      patch.selectedUri !== undefined ? asSelectedUri(patch.selectedUri) : current.selectedUri,
  }

  try {
    target.setItem(GRAPH_VIEW_STATE_KEY, JSON.stringify(next))
  } catch {
    // Storage can be unavailable in private mode or full; losing view state is acceptable.
  }
}

export function clearGraphViewState(storage?: Storage | null): void {
  const target = resolveStorage(storage)
  if (!target) return
  try {
    target.removeItem(GRAPH_VIEW_STATE_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}
