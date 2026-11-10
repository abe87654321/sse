import { MemoryGraphStore } from '../graph/memory-store';
import { loadShapes } from '../graph/ontology-loader';
import { sse } from '../graph/namespaces';
import { validateGraph } from '../reasoning/shacl';

const DATA = 'urn:sse:data';
const P = (name: string) => `<${sse(name)}>`;

const person = (id: string) => `<https://sse.local/person/${id}>`;
const report = (id: string) => `<https://sse.local/report/${id}>`;
const invoice = (id: string) => `<https://sse.local/invoice/${id}>`;

function validFixture(): string {
  return `
${report('r1')} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('ExpenseReport')} <${DATA}> .
${report('r1')} ${P('status')} "pending" <${DATA}> .
${report('r1')} ${P('submittedBy')} ${person('p1')} <${DATA}> .
${report('r1')} ${P('amount')} "100.00"^^<http://www.w3.org/2001/XMLSchema#decimal> <${DATA}> .

${report('r2')} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('ExpenseReport')} <${DATA}> .
${report('r2')} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('PaidReport')} <${DATA}> .
${report('r2')} ${P('status')} "paid" <${DATA}> .
${report('r2')} ${P('submittedBy')} ${person('p1')} <${DATA}> .
${report('r2')} ${P('paidAt')} "2026-11-10T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> <${DATA}> .
${report('r2')} ${P('paidBy')} ${person('p2')} <${DATA}> .

${invoice('v1')} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('Invoice')} <${DATA}> .
${invoice('v1')} ${P('invoiceNo')} "INV-1" <${DATA}> .
`;
}

async function storeFor(nquads: string): Promise<MemoryGraphStore> {
  const store = new MemoryGraphStore();
  await store.load(nquads);
  return store;
}

describe('SHACL validation', () => {
  it('accepts a complete report/invoice fixture', async () => {
    const store = await storeFor(validFixture());
    expect(await validateGraph(store, loadShapes())).toEqual([]);
  });

  it('reports a report without a submitter', async () => {
    const store = await storeFor(`
<https://sse.local/report/r3> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('ExpenseReport')} <${DATA}> .
<https://sse.local/report/r3> ${P('status')} "pending" <${DATA}> .
`);
    const violations = await validateGraph(store, loadShapes());
    const paths = violations.map((violation) => violation.path);
    expect(violations.some((violation) => violation.focusNode === 'https://sse.local/report/r3')).toBe(true);
    expect(paths).toContain(sse('submittedBy'));
  });

  it('reports a paid report without payment facts', async () => {
    const store = await storeFor(`
<https://sse.local/report/r4> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('PaidReport')} <${DATA}> .
<https://sse.local/report/r4> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('ExpenseReport')} <${DATA}> .
<https://sse.local/report/r4> ${P('status')} "paid" <${DATA}> .
<https://sse.local/report/r4> ${P('submittedBy')} ${person('p1')} <${DATA}> .
`);
    const paths = (await validateGraph(store, loadShapes())).map((violation) => violation.path);
    expect(paths).toContain(sse('paidAt'));
    expect(paths).toContain(sse('paidBy'));
  });

  it('reports an invoice without an invoice number', async () => {
    const store = await storeFor(`
<https://sse.local/invoice/v2> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('Invoice')} <${DATA}> .
`);
    const violations = await validateGraph(store, loadShapes());
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      focusNode: 'https://sse.local/invoice/v2',
      path: sse('invoiceNo'),
      severity: 'Violation',
    });
  });

  it('reports a status outside the allowed enum', async () => {
    const store = await storeFor(`
<https://sse.local/report/r5> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${P('ExpenseReport')} <${DATA}> .
<https://sse.local/report/r5> ${P('status')} "archived" <${DATA}> .
<https://sse.local/report/r5> ${P('submittedBy')} ${person('p1')} <${DATA}> .
`);
    const paths = (await validateGraph(store, loadShapes())).map((violation) => violation.path);
    expect(paths).toContain(sse('status'));
  });
});
