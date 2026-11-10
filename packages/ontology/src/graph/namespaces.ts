export const SSE = 'https://sse.local/ontology#';
export const INST = 'https://sse.local/';
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
export const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const PROV = 'http://www.w3.org/ns/prov#';
export const provGeneratedAtTime = `${PROV}generatedAtTime`;

export const GRAPH = {
  tbox: 'urn:sse:tbox',
  data: 'urn:sse:data',
  inferred: 'urn:sse:inferred',
  history: 'urn:sse:history',
  manual: 'urn:sse:manual',
} as const;

export const uri = {
  person: (id: string) => `${INST}person/${id}`,
  department: (name: string) => `${INST}dept/${encodeURIComponent(name)}`,
  category: (id: string) => `${INST}category/${id}`,
  report: (id: string) => `${INST}report/${id}`,
  item: (id: string) => `${INST}item/${id}`,
  invoice: (id: string) => `${INST}invoice/${id}`,
  rule: (id: string) => `${INST}rule/${id}`,
  approval: (id: string) => `${INST}approval/${id}`,
  payment: (id: string) => `${INST}payment/${id}`,
};

export const sse = (name: string) => `${SSE}${name}`;
