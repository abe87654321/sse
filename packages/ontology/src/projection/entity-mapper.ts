import { GRAPH, RDF_TYPE, XSD, provGeneratedAtTime, uri, sse } from '../graph/namespaces';
import type { ProjectedQuad } from '../graph/types';

export type MappedTable =
  | 'users' | 'expense_categories' | 'expense_reports' | 'expense_items'
  | 'invoices' | 'approval_rules' | 'approval_records' | 'payment_receipts';

export interface EntityWrite {
  uri: string;
  quads: ProjectedQuad[];
  /** Only these outgoing predicates may be deleted+replaced. */
  ownedPredicates: string[];
}

export interface RelationWrite {
  from: string;
  predicate: string;
  to: string;
}

export interface EntityProjection {
  writes: EntityWrite[];
  add: RelationWrite[];
  remove: RelationWrite[];
}

const q = (
  subject: string,
  predicate: string,
  object: string,
  objectType: 'iri' | 'literal',
  datatype?: string,
): ProjectedQuad => ({
  subject,
  predicate: sse(predicate),
  object,
  objectType,
  datatype,
  graph: GRAPH.data,
});

const qIri = (
  subject: string,
  predicate: string,
  object: string,
  objectType: 'iri' | 'literal',
  datatype?: string,
): ProjectedQuad => ({
  subject,
  predicate,
  object,
  objectType,
  datatype,
  graph: GRAPH.data,
});

function isoDateTime(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace(/\.000Z$/, 'Z');
}

function isoDate(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value);
  const match = /^\d{4}-\d{2}-\d{2}/.exec(text);
  return match ? match[0] : text;
}

function addLiteral(
  quads: ProjectedQuad[],
  subject: string,
  predicate: string,
  value: unknown,
  datatype?: string,
): void {
  if (value === null || value === undefined) return;
  quads.push(q(subject, predicate, String(value), 'literal', datatype));
}

function addBoolean(
  quads: ProjectedQuad[],
  subject: string,
  predicate: string,
  value: unknown,
): void {
  if (value === null || value === undefined) return;
  quads.push(q(subject, predicate, value === true || value === 'true' ? 'true' : 'false', 'literal', `${XSD}boolean`));
}

function addIri(
  quads: ProjectedQuad[],
  subject: string,
  predicate: string,
  value: unknown,
): void {
  if (value === null || value === undefined || value === '') return;
  quads.push(q(subject, predicate, String(value), 'iri'));
}

function typeQuad(subject: string, className: string): ProjectedQuad {
  return qIri(subject, RDF_TYPE, sse(className), 'iri');
}

function provenance(subject: string, table: string, row: Record<string, any>): ProjectedQuad[] {
  const rawVersion = row.updated_at ?? row.uploaded_at ?? row.created_at ?? '';
  const version = rawVersion === '' ? '' : isoDateTime(rawVersion);
  const quads: ProjectedQuad[] = [
    q(subject, 'sourceTable', table, 'literal'),
    q(subject, 'sourceId', String(row.id), 'literal'),
    q(subject, 'recordVersion', version, 'literal', `${XSD}dateTime`),
  ];
  if (version !== '') {
    quads.push(qIri(subject, provGeneratedAtTime, version, 'literal', `${XSD}dateTime`));
  }
  return quads;
}

const CLASS_BY_TABLE: Record<MappedTable, string> = {
  users: 'Person',
  expense_categories: 'ExpenseCategory',
  expense_reports: 'ExpenseReport',
  expense_items: 'ExpenseItem',
  invoices: 'Invoice',
  approval_rules: 'ApprovalRule',
  approval_records: 'ApprovalRecord',
  payment_receipts: 'PaymentReceipt',
};

const BASE_PROVENANCE = [sse('sourceTable'), sse('sourceId'), sse('recordVersion'), provGeneratedAtTime];
const owned = (...predicates: string[]): string[] => [RDF_TYPE, ...BASE_PROVENANCE, ...predicates.map(sse)];

const OWNED: Record<MappedTable, string[]> = {
  users: owned('name', 'department', 'role', 'status', 'belongsTo', 'deletedAt'),
  expense_categories: owned('name', 'isActive', 'sortOrder'),
  expense_reports: owned(
    'serialNo', 'title', 'amount', 'status', 'currentStep', 'submittedAt', 'completedAt',
    'paidAt', 'paymentRef', 'submittedBy', 'paidBy',
  ),
  expense_items: owned('amount', 'expenseDate', 'description', 'hasCategory'),
  invoices: owned('invoiceNo', 'verificationStatus', 'fileName', 'checksum', 'uploadedAt'),
  approval_rules: owned(
    'name', 'minAmount', 'maxAmount', 'priority', 'isActive', 'approvalChain', 'hasCategoryRule',
  ),
  approval_records: owned('step', 'result', 'comment', 'stepStartedAt', 'approvedAt', 'approvedBy'),
  payment_receipts: owned('verificationStatus', 'fileName', 'checksum', 'uploadedAt'),
};

const DEPARTMENT_OWNED = [RDF_TYPE, sse('name')];

export const PREDICATES: string[] = [
  'belongsTo', 'submittedBy', 'paidBy', 'containsItem', 'hasCategory', 'hasInvoice',
  'hasApproval', 'hasPaymentReceipt', 'approvedBy', 'hasCategoryRule',
  'name', 'department', 'role', 'status', 'deletedAt',
  'serialNo', 'title', 'amount', 'currentStep', 'submittedAt', 'completedAt', 'paidAt', 'paymentRef',
  'expenseDate', 'description', 'invoiceNo', 'verificationStatus', 'fileName', 'checksum', 'uploadedAt',
  'minAmount', 'maxAmount', 'priority', 'isActive', 'sortOrder', 'approvalChain',
  'step', 'result', 'comment', 'stepStartedAt', 'approvedAt',
  'sourceTable', 'sourceId', 'recordVersion',
];

export function entityUri(table: string, id: string): string {
  switch (table) {
    case 'users': return uri.person(id);
    case 'expense_categories': return uri.category(id);
    case 'expense_reports': return uri.report(id);
    case 'expense_items': return uri.item(id);
    case 'invoices': return uri.invoice(id);
    case 'approval_rules': return uri.rule(id);
    case 'approval_records': return uri.approval(id);
    case 'payment_receipts': return uri.payment(id);
    default: throw new Error(`unmapped table ${table}`);
  }
}

export function projectRow(
  table: MappedTable,
  op: 'INSERT' | 'UPDATE',
  row: Record<string, any>,
  oldRow: Record<string, any> | null = null,
): EntityProjection {
  const subject = entityUri(table, String(row.id));
  const className = CLASS_BY_TABLE[table];
  if (!className) throw new Error(`unmapped table ${table}`);

  const quads: ProjectedQuad[] = [typeQuad(subject, className), ...provenance(subject, table, row)];
  const add: RelationWrite[] = [];
  const remove: RelationWrite[] = [];
  const extraWrites: EntityWrite[] = [];

  switch (table) {
    case 'users': {
      const department = row.department ?? '未分配';
      const deleted = row.deleted_at !== null && row.deleted_at !== undefined;
      addLiteral(quads, subject, 'name', row.name);
      addLiteral(quads, subject, 'department', department);
      addLiteral(quads, subject, 'role', row.role);
      addLiteral(quads, subject, 'status', deleted ? 'deleted' : row.status);
      if (deleted) {
        addLiteral(quads, subject, 'deletedAt', isoDateTime(row.deleted_at), `${XSD}dateTime`);
      } else {
        addIri(quads, subject, 'belongsTo', uri.department(String(department)));
      }

      const departmentSubject = uri.department(String(department));
      extraWrites.push({
        uri: departmentSubject,
        quads: [
          typeQuad(departmentSubject, 'Department'),
          q(departmentSubject, 'name', String(department), 'literal'),
        ],
        ownedPredicates: DEPARTMENT_OWNED,
      });
      break;
    }
    case 'expense_categories':
      addLiteral(quads, subject, 'name', row.name);
      addBoolean(quads, subject, 'isActive', row.is_active);
      addLiteral(quads, subject, 'sortOrder', row.sort_order, `${XSD}integer`);
      break;
    case 'expense_reports':
      addLiteral(quads, subject, 'serialNo', row.serial_no);
      addLiteral(quads, subject, 'title', row.title);
      addLiteral(quads, subject, 'amount', row.total_amount, `${XSD}decimal`);
      addLiteral(quads, subject, 'status', row.status);
      addLiteral(quads, subject, 'currentStep', row.current_step, `${XSD}integer`);
      if (row.submitted_at !== null && row.submitted_at !== undefined) {
        addLiteral(quads, subject, 'submittedAt', isoDateTime(row.submitted_at), `${XSD}dateTime`);
      }
      if (row.completed_at !== null && row.completed_at !== undefined) {
        addLiteral(quads, subject, 'completedAt', isoDateTime(row.completed_at), `${XSD}dateTime`);
      }
      if (row.paid_at !== null && row.paid_at !== undefined) {
        addLiteral(quads, subject, 'paidAt', isoDateTime(row.paid_at), `${XSD}dateTime`);
      }
      addLiteral(quads, subject, 'paymentRef', row.payment_ref);
      addIri(quads, subject, 'submittedBy', row.user_id ? uri.person(String(row.user_id)) : null);
      addIri(quads, subject, 'paidBy', row.paid_by ? uri.person(String(row.paid_by)) : null);
      break;
    case 'expense_items': {
      addLiteral(quads, subject, 'amount', row.amount, `${XSD}decimal`);
      if (row.expense_date !== null && row.expense_date !== undefined) {
        addLiteral(quads, subject, 'expenseDate', isoDate(row.expense_date), `${XSD}date`);
      }
      addLiteral(quads, subject, 'description', row.description);
      addIri(quads, subject, 'hasCategory', row.category_id ? uri.category(String(row.category_id)) : null);
      const oldParent = oldRow?.report_id;
      if (oldParent && oldParent !== row.report_id) {
        remove.push({ from: uri.report(String(oldParent)), predicate: sse('containsItem'), to: subject });
      }
      if (row.report_id) {
        add.push({ from: uri.report(String(row.report_id)), predicate: sse('containsItem'), to: subject });
      }
      break;
    }
    case 'invoices': {
      addLiteral(quads, subject, 'invoiceNo', row.invoice_no);
      addLiteral(quads, subject, 'verificationStatus', row.verification_status);
      addLiteral(quads, subject, 'fileName', row.file_name);
      addLiteral(quads, subject, 'checksum', row.checksum);
      if (row.uploaded_at !== null && row.uploaded_at !== undefined) {
        addLiteral(quads, subject, 'uploadedAt', isoDateTime(row.uploaded_at), `${XSD}dateTime`);
      }
      const oldParent = oldRow?.item_id;
      if (oldParent && oldParent !== row.item_id) {
        remove.push({ from: uri.item(String(oldParent)), predicate: sse('hasInvoice'), to: subject });
      }
      if (row.item_id) {
        add.push({ from: uri.item(String(row.item_id)), predicate: sse('hasInvoice'), to: subject });
      }
      break;
    }
    case 'approval_rules': {
      addLiteral(quads, subject, 'name', row.name);
      addLiteral(quads, subject, 'minAmount', row.min_amount, `${XSD}decimal`);
      addLiteral(quads, subject, 'maxAmount', row.max_amount, `${XSD}decimal`);
      addLiteral(quads, subject, 'priority', row.priority, `${XSD}integer`);
      addBoolean(quads, subject, 'isActive', row.is_active);
      if (row.approval_chain !== null && row.approval_chain !== undefined) {
        addLiteral(
          quads,
          subject,
          'approvalChain',
          typeof row.approval_chain === 'string' ? row.approval_chain : JSON.stringify(row.approval_chain),
        );
      }
      for (const categoryId of row.category_ids ?? []) {
        addIri(quads, subject, 'hasCategoryRule', uri.category(String(categoryId)));
      }
      break;
    }
    case 'approval_records': {
      addLiteral(quads, subject, 'step', row.step, `${XSD}integer`);
      addLiteral(quads, subject, 'result', row.result);
      addLiteral(quads, subject, 'comment', row.comment);
      if (row.step_started_at !== null && row.step_started_at !== undefined) {
        addLiteral(quads, subject, 'stepStartedAt', isoDateTime(row.step_started_at), `${XSD}dateTime`);
      }
      if (row.approved_at !== null && row.approved_at !== undefined) {
        addLiteral(quads, subject, 'approvedAt', isoDateTime(row.approved_at), `${XSD}dateTime`);
      }
      addIri(quads, subject, 'approvedBy', row.approver_id ? uri.person(String(row.approver_id)) : null);
      const oldParent = oldRow?.report_id;
      if (oldParent && oldParent !== row.report_id) {
        remove.push({ from: uri.report(String(oldParent)), predicate: sse('hasApproval'), to: subject });
      }
      if (row.report_id) {
        add.push({ from: uri.report(String(row.report_id)), predicate: sse('hasApproval'), to: subject });
      }
      break;
    }
    case 'payment_receipts': {
      addLiteral(quads, subject, 'verificationStatus', row.verification_status);
      addLiteral(quads, subject, 'fileName', row.file_name);
      addLiteral(quads, subject, 'checksum', row.checksum);
      if (row.uploaded_at !== null && row.uploaded_at !== undefined) {
        addLiteral(quads, subject, 'uploadedAt', isoDateTime(row.uploaded_at), `${XSD}dateTime`);
      }
      const oldParent = oldRow?.report_id;
      if (oldParent && oldParent !== row.report_id) {
        remove.push({ from: uri.report(String(oldParent)), predicate: sse('hasPaymentReceipt'), to: subject });
      }
      if (row.report_id) {
        add.push({ from: uri.report(String(row.report_id)), predicate: sse('hasPaymentReceipt'), to: subject });
      }
      break;
    }
  }

  return {
    writes: [{ uri: subject, quads, ownedPredicates: OWNED[table] }, ...extraWrites],
    add,
    remove,
  };
}
