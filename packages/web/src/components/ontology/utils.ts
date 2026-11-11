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

export function entityLabel(node: LabelSource): string {
  const properties = node.properties ?? {}
  const candidates = [
    node.label,
    properties.title,
    properties.serialNo,
    properties.name,
    properties.fileName,
    properties.category,
  ]
  for (const candidate of candidates) {
    if (candidate) return candidate
  }
  return localName(node.uri ?? node.id) || node.type || 'unknown'
}
