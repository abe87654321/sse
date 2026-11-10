import { buildOpenApiDocument } from '../openapi';

type AnyDoc = Record<string, any>;

describe('OpenAPI document', () => {
  const doc = buildOpenApiDocument() as AnyDoc;

  it('is OpenAPI 3.1', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info?.title).toContain('SSE');
  });

  it('exposes the agent-facing endpoints', () => {
    const required = [
      '/auth/api-key-login',
      '/expenses',
      '/expenses/{id}',
      '/expenses/{id}/submit',
      '/expenses/{id}/verify',
      '/expenses/{id}/items/{itemId}/invoice',
      '/expenses/from-invoice',
      '/approvals/pending',
      '/approvals/{reportId}/approve',
      '/approvals/{reportId}/reject',
      '/statistics',
      '/ontology/submit-from-text',
      '/ontology/query-expense-status',
      '/ontology/sparql',
      '/ontology/status',
      '/ontology/schema',
      '/ontology/entities',
      '/ontology/entities/{uri}',
      '/ontology/entities/{uri}/network',
      '/ontology/query',
      '/ontology/anomalies',
    ];
    for (const path of required) {
      expect(doc.paths[path]).toBeDefined();
    }

    expect(doc.paths['/ontology/query'].post).toBeDefined();
    expect(doc.paths['/ontology/entities'].get).toBeDefined();
    expect(doc.paths['/ontology/entities/{uri}/network'].get).toBeDefined();
  });

  it('does not advertise 501 placeholder endpoints as contracts', () => {
    for (const path of ['/ontology/validate', '/ontology/explain', '/ontology/impact']) {
      expect(doc.paths[path]).toBeUndefined();
    }
  });

  it('declares bearer auth and keeps the login endpoint public', () => {
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(doc.paths['/auth/api-key-login'].post.security).toEqual([]);
  });

  it('only references defined schemas', () => {
    const refs = new Set<string>();
    const walk = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.$ref === 'string') refs.add(value.$ref);
      for (const key of Object.keys(value)) walk(value[key]);
    };
    walk(doc);

    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('#/components/schemas/')).toBe(true);
      const name = ref.split('/').pop() as string;
      expect(doc.components.schemas[name]).toBeDefined();
    }
  });
});
