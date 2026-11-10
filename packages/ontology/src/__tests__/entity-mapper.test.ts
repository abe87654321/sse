import { projectRow, entityUri, PREDICATES } from '../projection/entity-mapper';
import { RDF_TYPE, SSE, XSD, sse, uri } from '../graph/namespaces';

function findQuad(quads: any[], predicate: string) {
  return quads.find(q => q.predicate === predicate);
}

function hasType(quads: any[], type: string) {
  return quads.some(q => q.predicate === RDF_TYPE && q.object === sse(type));
}

describe('projectRow', () => {
  it('maps a pending report without leaking secrets', () => {
    const p = projectRow('expense_reports', 'UPDATE', {
      id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: '差旅', total_amount: '120.50',
      status: 'pending', current_step: 1, submitted_at: '2026-11-10T00:00:00Z',
      updated_at: '2026-11-10T00:01:00Z', paid_by: null,
    });
    expect(p.writes[0].uri).toBe('https://sse.local/report/r1');
    const quads = p.writes[0].quads;
    expect(quads).toContainEqual(expect.objectContaining({ predicate: sse('status'), object: 'pending' }));
    expect(quads).toContainEqual(expect.objectContaining({ predicate: sse('submittedBy'), object: 'https://sse.local/person/p1', objectType: 'iri' }));
    expect(p.writes[0].ownedPredicates).toContain(sse('submittedBy'));
    expect(p.add).toEqual([]);
    expect(JSON.stringify(quads)).not.toContain('password');
  });

  it('maps rejected as rejected, not approved', () => {
    const p = projectRow('expense_reports', 'UPDATE', {
      id: 'r2', serial_no: 'RE-2', user_id: 'p1', title: 'x', total_amount: '1',
      status: 'rejected', current_step: 1, updated_at: '2026-11-10T00:01:00Z',
    });
    const quads = p.writes[0].quads;
    expect(quads.find(q => q.predicate === sse('status'))!.object).toBe('rejected');
    expect(quads.some(q => q.objectType === 'iri' && q.object.endsWith('ApprovedReport'))).toBe(false);
  });

  it('maps a user without phone or email and writes the department node', () => {
    const p = projectRow('users', 'INSERT', {
      id: 'p1', name: '张三', phone: '13800000000', email: 'a@b.com',
      department: '研发', role: 'employee', status: 'active', password_hash: 'x',
    });
    expect(p.writes.map(w => w.uri)).toContain('https://sse.local/person/p1');
    expect(p.writes.map(w => w.uri)).toContain('https://sse.local/dept/%E7%A0%94%E5%8F%91');
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain('13800000000');
    expect(serialized).not.toContain('a@b.com');
    expect(serialized).not.toContain('password_hash');
  });

  it('retracts the old parent when a child moves', () => {
    const p = projectRow('expense_items', 'UPDATE', {
      id: 'i1', report_id: 'r2', category_id: 'c1', amount: '10', expense_date: '2026-11-10', description: 'x',
    }, { id: 'i1', report_id: 'r1', category_id: 'c2' });
    expect(p.remove).toContainEqual({ from: 'https://sse.local/report/r1', predicate: sse('containsItem'), to: 'https://sse.local/item/i1' });
    expect(p.add).toContainEqual({ from: 'https://sse.local/report/r2', predicate: sse('containsItem'), to: 'https://sse.local/item/i1' });
  });

  it('maps expense categories with typed literals', () => {
    const p = projectRow('expense_categories', 'INSERT', {
      id: 'c1', name: '差旅', is_active: true, sort_order: 1,
    });
    expect(p.writes[0].uri).toBe(entityUri('expense_categories', 'c1'));
    expect(hasType(p.writes[0].quads, 'ExpenseCategory')).toBe(true);
    expect(findQuad(p.writes[0].quads, sse('isActive'))).toMatchObject({ object: 'true', datatype: `${XSD}boolean` });
    expect(findQuad(p.writes[0].quads, sse('sortOrder'))).toMatchObject({ object: '1', datatype: `${XSD}integer` });
  });

  it('maps expense items with category and parent relation', () => {
    const p = projectRow('expense_items', 'INSERT', {
      id: 'i1', report_id: 'r1', category_id: 'c1', amount: '10.25', expense_date: '2026-11-10', description: 'taxi',
    });
    expect(p.writes[0].uri).toBe(entityUri('expense_items', 'i1'));
    expect(hasType(p.writes[0].quads, 'ExpenseItem')).toBe(true);
    expect(findQuad(p.writes[0].quads, sse('hasCategory'))).toMatchObject({ object: 'https://sse.local/category/c1', objectType: 'iri' });
    expect(p.add).toContainEqual({ from: 'https://sse.local/report/r1', predicate: sse('containsItem'), to: 'https://sse.local/item/i1' });
  });

  it('maps invoices with invoice number and item relation', () => {
    const p = projectRow('invoices', 'INSERT', {
      id: 'v1', item_id: 'i1', invoice_no: 'INV-1', verification_status: 'verified',
      file_name: 'a.pdf', checksum: 'abc', uploaded_at: '2026-11-10T00:00:00Z',
      storage_key: 'secret', ocr_result: { text: 'secret' },
    });
    expect(p.writes[0].uri).toBe(entityUri('invoices', 'v1'));
    expect(hasType(p.writes[0].quads, 'Invoice')).toBe(true);
    expect(findQuad(p.writes[0].quads, sse('invoiceNo'))!.object).toBe('INV-1');
    expect(p.add).toContainEqual({ from: 'https://sse.local/item/i1', predicate: sse('hasInvoice'), to: 'https://sse.local/invoice/v1' });
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain('secret');
  });

  it('maps approval rules with category ids and approval chain', () => {
    const p = projectRow('approval_rules', 'INSERT', {
      id: 'a1', name: 'rule', min_amount: '0', max_amount: '1000', priority: 2,
      is_active: true, approval_chain: [{ step: 1, role: 'finance' }], category_ids: ['c1', 'c2'],
    });
    expect(p.writes[0].uri).toBe(entityUri('approval_rules', 'a1'));
    expect(hasType(p.writes[0].quads, 'ApprovalRule')).toBe(true);
    const categoryEdges = p.writes[0].quads.filter(q => q.predicate === sse('hasCategoryRule'));
    expect(categoryEdges.map(q => q.object).sort()).toEqual(['https://sse.local/category/c1', 'https://sse.local/category/c2']);
    expect(findQuad(p.writes[0].quads, sse('approvalChain'))!.object).toBe('[{"step":1,"role":"finance"}]');
  });

  it('maps approval records with approver and report relation', () => {
    const p = projectRow('approval_records', 'INSERT', {
      id: 'ap1', report_id: 'r1', approver_id: 'p1', step: 2, result: 'approved',
      comment: 'ok', step_started_at: '2026-11-10T00:00:00Z', approved_at: '2026-11-10T00:01:00Z',
    });
    expect(p.writes[0].uri).toBe(entityUri('approval_records', 'ap1'));
    expect(hasType(p.writes[0].quads, 'ApprovalRecord')).toBe(true);
    expect(findQuad(p.writes[0].quads, sse('approvedBy'))).toMatchObject({ object: 'https://sse.local/person/p1', objectType: 'iri' });
    expect(p.add).toContainEqual({ from: 'https://sse.local/report/r1', predicate: sse('hasApproval'), to: 'https://sse.local/approval/ap1' });
  });

  it('maps payment receipts as artifacts without monetary facts', () => {
    const p = projectRow('payment_receipts', 'INSERT', {
      id: 'pay1', report_id: 'r1', verification_status: 'verified', file_name: 'receipt.pdf',
      checksum: 'abc', uploaded_at: '2026-11-10T00:00:00Z', amount: '10', status: 'paid', paid_at: '2026-11-10T00:00:00Z',
    });
    expect(p.writes[0].uri).toBe(entityUri('payment_receipts', 'pay1'));
    expect(hasType(p.writes[0].quads, 'PaymentReceipt')).toBe(true);
    expect(p.add).toContainEqual({ from: 'https://sse.local/report/r1', predicate: sse('hasPaymentReceipt'), to: 'https://sse.local/payment/pay1' });
    const predicates = p.writes[0].quads.map(q => q.predicate);
    expect(predicates).not.toContain(sse('amount'));
    expect(predicates).not.toContain(sse('status'));
    expect(predicates).not.toContain(sse('paidAt'));
  });

  it('marks a soft-deleted user and drops the department edge', () => {
    const p = projectRow('users', 'UPDATE', {
      id: 'p1', name: '张三', department: '研发', role: 'employee', status: 'active',
      updated_at: '2026-11-10T00:00:00Z', deleted_at: '2026-11-10T00:00:00Z',
    });
    const person = p.writes[0];
    expect(findQuad(person.quads, sse('status'))!.object).toBe('deleted');
    expect(findQuad(person.quads, sse('deletedAt'))!.object).toBe('2026-11-10T00:00:00Z');
    expect(person.quads.some(q => q.predicate === sse('belongsTo'))).toBe(false);
    expect(findQuad(person.quads, sse('recordVersion'))!.datatype).toBeUndefined();
  });

  it('emits recordVersion as an untyped string', () => {
    const p = projectRow('expense_reports', 'UPDATE', {
      id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: 't', total_amount: '10',
      status: 'pending', current_step: 1, updated_at: '2026-11-10T00:01:00Z',
    });
    const version = findQuad(p.writes[0].quads, sse('recordVersion'))!;
    expect(version.object).toBe('2026-11-10T00:01:00Z');
    expect(version.datatype).toBeUndefined();
  });

  it('never emits an empty typed recordVersion literal', () => {
    const p = projectRow('expense_categories', 'INSERT', { id: 'c1', name: '差旅' });
    const version = findQuad(p.writes[0].quads, sse('recordVersion'))!;
    expect(version.object).toBe('');
    expect(version.datatype).toBeUndefined();
  });

  it('defaults a missing department to 未分配', () => {
    const p = projectRow('users', 'INSERT', {
      id: 'p1', name: '张三', department: null, role: 'employee', status: 'active',
    });
    expect(p.writes.map(w => w.uri)).toContain(uri.department('未分配'));
  });

  it('exports every predicate it can emit', () => {
    expect(PREDICATES).toEqual(expect.arrayContaining([
      'belongsTo', 'submittedBy', 'containsItem', 'hasCategory', 'hasInvoice',
      'hasApproval', 'hasPaymentReceipt', 'approvedBy', 'paidBy', 'hasCategoryRule',
      'name', 'department', 'role', 'status', 'deletedAt', 'serialNo', 'title',
      'amount', 'currentStep', 'submittedAt', 'completedAt', 'paidAt', 'paymentRef',
      'expenseDate', 'description', 'invoiceNo', 'verificationStatus', 'fileName',
      'checksum', 'uploadedAt', 'minAmount', 'maxAmount', 'priority', 'isActive',
      'sortOrder', 'approvalChain', 'step', 'result', 'comment', 'stepStartedAt',
      'approvedAt', 'sourceTable', 'sourceId', 'recordVersion',
    ]));
    expect(PREDICATES.every(p => typeof p === 'string' && !p.startsWith(SSE))).toBe(true);
  });
});
