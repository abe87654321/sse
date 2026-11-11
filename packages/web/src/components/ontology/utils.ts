export function localName(iri: string | undefined): string {
  if (!iri) return ''
  const hash = iri.lastIndexOf('#')
  if (hash >= 0) return iri.slice(hash + 1)
  const slash = iri.lastIndexOf('/')
  return slash >= 0 ? iri.slice(slash + 1) : iri
}

export interface LabelSource {
  uri?: string
  id?: string
  label?: string
  type?: string
  properties?: Record<string, string>
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const LONG_TOKEN_PATTERN = /^[A-Za-z0-9]{24,}$/

function lookOpaque(value: string | undefined): boolean {
  if (typeof value !== 'string') return true
  const text = value.trim()
  if (!text) return true
  if (UUID_PATTERN.test(text)) return true
  if (LONG_TOKEN_PATTERN.test(text) && /\d/.test(text)) return true
  return false
}

/** True for UUIDs, URI ids such as `item/<uuid>`, checksums and long storage keys. */
export function isOpaqueIdentifier(value: string | undefined): boolean {
  return lookOpaque(value)
}

export function entityLabel(node: LabelSource): string {
  const properties = node.properties ?? {}
  const candidates = [
    properties.title,
    properties.serialNo,
    properties.name,
    properties.description,
    properties.invoiceNo,
    properties.paymentRef,
    properties.fileName,
    properties.category,
    properties.comment,
    node.label,
    localName(node.uri ?? node.id),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (lookOpaque(candidate)) continue
    return candidate
  }
  return ''
}

export interface GraphNodeLike extends LabelSource {
  uri: string
  id?: string
  type?: string
}

export interface GraphFilters {
  type?: string
  status?: string
  department?: string
  term?: string
}

export function graphNodeId(node: GraphNodeLike): string {
  return node.id || node.uri
}

export function matchesGraphFilters(node: GraphNodeLike, filters: GraphFilters): boolean {
  if (filters.type && node.type !== filters.type) return false
  if (filters.status && node.properties?.status !== filters.status) return false
  if (filters.department && node.properties?.department !== filters.department) return false

  const term = filters.term?.trim().toLowerCase()
  if (!term) return true

  const haystack = [
    graphNodeId(node),
    node.label ?? '',
    node.type ?? '',
    ...Object.values(node.properties ?? {}),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

/**
 * Filter first, then apply the render cap. The selected node is always kept so
 * a selection made through validation/impact links cannot disappear when the
 * current filters or the node cap exclude it.
 */
export function selectVisibleGraphNodes<T extends GraphNodeLike>(
  nodes: T[],
  filters: GraphFilters,
  maxNodes: number,
  selected?: string | null,
): T[] {
  const limit = Math.max(0, Math.floor(maxNodes))
  const visible = nodes.filter((node) => matchesGraphFilters(node, filters)).slice(0, limit)

  if (selected && !visible.some((node) => graphNodeId(node) === selected)) {
    const selectedNode = nodes.find((node) => graphNodeId(node) === selected)
    if (selectedNode) visible.push(selectedNode)
  }

  return visible
}
