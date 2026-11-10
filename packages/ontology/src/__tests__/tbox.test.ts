import { readFileSync } from 'fs';
import { join } from 'path';
import { Parser } from 'n3';
import { MemoryGraphStore } from '../graph/memory-store';
import { loadTBox } from '../graph/ontology-loader';
import { PROV, RDF_TYPE, sse } from '../graph/namespaces';

const ttl = readFileSync(join(__dirname, '../graph/ontology/sse.ttl'), 'utf-8');
const quads = new Parser().parse(ttl);

function hasType(uri: string, type: string) {
  return quads.some(q => q.subject.value === sse(uri) && q.predicate.value.endsWith('#type') && q.object.value.endsWith(type));
}

const MAPPED_PREDICATES = [
  'belongsTo', 'submittedBy', 'containsItem', 'hasCategory', 'hasInvoice',
  'hasApproval', 'approvedBy', 'governedBy', 'paidBy', 'hasPaymentReceipt',
  'hasCategoryRule', 'uploadedBy',
  'name', 'department', 'role', 'status', 'amount', 'serialNo', 'title',
  'currentStep', 'submittedAt', 'completedAt', 'createdAt', 'updatedAt',
  'paidAt', 'paymentRef', 'expenseDate', 'description', 'fileName',
  'fileFormat', 'fileSize', 'checksum', 'uploadedAt', 'verificationStatus',
  'verifiedAt', 'minAmount', 'maxAmount', 'priority', 'isActive', 'sortOrder',
  'approvalChain', 'step', 'stepStartedAt', 'result', 'comment', 'approvedAt',
  'sourceTable', 'sourceId', 'recordVersion', 'deletedAt',
];

describe('SSE TBox', () => {
  it.each([
    'Person', 'Department', 'ExpenseCategory', 'ExpenseReport', 'ExpenseItem',
    'Invoice', 'ApprovalRule', 'ApprovalRecord', 'PaymentReceipt',
  ])('declares %s as an owl:Class', (cls) => {
    expect(hasType(cls, 'Class')).toBe(true);
  });

  it('declares core object properties with domain and range', () => {
    for (const p of ['submittedBy', 'containsItem', 'hasCategory', 'hasInvoice', 'approvedBy', 'governedBy', 'belongsTo', 'paidBy', 'hasPaymentReceipt']) {
      const subject = sse(p);
      expect(quads.some(q => q.subject.value === subject && q.predicate.value.endsWith('#type'))).toBe(true);
      expect(quads.some(q => q.subject.value === subject && q.predicate.value.endsWith('#domain'))).toBe(true);
      expect(quads.some(q => q.subject.value === subject && q.predicate.value.endsWith('#range'))).toBe(true);
    }
  });

  it('declares every predicate the mapper can emit', () => {
    for (const p of MAPPED_PREDICATES) {
      expect(hasType(p, 'Property')).toBe(true);
    }
  });

  it('does not restrict shared predicates to a single domain', () => {
    for (const p of ['name', 'verificationStatus']) {
      expect(
        quads.some(q => q.subject.value === sse(p) && q.predicate.value.endsWith('#domain')),
      ).toBe(false);
    }
  });

  it('declares prov:generatedAtTime for Phase 2 mapping', () => {
    const property = `${PROV}generatedAtTime`;
    expect(
      quads.some(
        q =>
          q.subject.value === property &&
          q.predicate.value.endsWith('#type') &&
          q.object.value.endsWith('DatatypeProperty'),
      ),
    ).toBe(true);
    expect(
      quads.some(
        q =>
          q.subject.value === property &&
          q.predicate.value.endsWith('#range') &&
          q.object.value === 'http://www.w3.org/2001/XMLSchema#dateTime',
      ),
    ).toBe(true);
  });
});

describe('ontology loader', () => {
  it('loads the TBox into urn:sse:tbox', async () => {
    const store = new MemoryGraphStore();
    await loadTBox(store);
    const res = await store.query(
      `SELECT ?s WHERE { GRAPH <urn:sse:tbox> { ?s <${RDF_TYPE}> <http://www.w3.org/2002/07/owl#Class> } }`,
    );
    if (res.kind !== 'select') throw new Error('expected select result');
    expect(res.rows.some(r => r.s === sse('ExpenseReport'))).toBe(true);
  });
});
