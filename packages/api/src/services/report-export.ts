import ExcelJS from 'exceljs';

const MAX_REPORTS = 20000;

export interface ReportExportFilter {
  dateFrom?: string;
  dateTo?: string;
  department?: string;
  userId?: string;
}

export async function loadReportExportDataset(client: any, filter: ReportExportFilter) {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;
  if (filter.userId) { conditions.push(`er.user_id = $${idx++}`); params.push(filter.userId); }
  if (filter.department) { conditions.push(`u.department = $${idx++}`); params.push(filter.department); }
  if (filter.dateFrom) { conditions.push(`er.created_at >= $${idx++}::date`); params.push(filter.dateFrom); }
  if (filter.dateTo) { conditions.push(`er.created_at < ($${idx++}::date + INTERVAL '1 day')`); params.push(filter.dateTo); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: reportRows } = await client.query(
    `SELECT er.*, u.name AS applicant_name, u.department
       FROM expense_reports er
       JOIN users u ON u.id = er.user_id
       ${where}
      ORDER BY er.created_at DESC
      LIMIT ${MAX_REPORTS + 1}`,
    params
  );
  if (reportRows.length > MAX_REPORTS) throw new Error('EXPORT_TOO_LARGE');

  const ids = reportRows.map((row: any) => row.id);
  const items = await queryByIds(
    client,
    `SELECT ei.*, ec.name AS category_name
       FROM expense_items ei
       LEFT JOIN expense_categories ec ON ec.id = ei.category_id
      WHERE ei.report_id = ANY($1::uuid[])
      ORDER BY ei.expense_date`,
    ids
  );
  const invoices = await queryByIds(
    client,
    `SELECT i.*, ei.report_id
       FROM invoices i
       JOIN expense_items ei ON ei.id = i.item_id
      WHERE ei.report_id = ANY($1::uuid[])
      ORDER BY i.uploaded_at`,
    ids
  );
  const approvals = await queryByIds(
    client,
    `SELECT ar.*, au.name AS approver_name
       FROM approval_records ar
       LEFT JOIN users au ON au.id = ar.approver_id
      WHERE ar.report_id = ANY($1::uuid[])
      ORDER BY ar.step`,
    ids
  );
  const payments = await queryByIds(
    client,
    `SELECT er.id AS report_id, er.paid_at, er.payment_ref, er.payment_comment,
            pu.name AS paid_by_name, pr.file_name, pr.storage_key, pr.storage_bucket,
            pr.checksum, pr.verification_status, pr.uploaded_at
       FROM expense_reports er
       LEFT JOIN users pu ON pu.id = er.paid_by
       LEFT JOIN payment_receipts pr ON pr.report_id = er.id
      WHERE er.id = ANY($1::uuid[])`,
    ids
  );

  const itemsBy = groupBy(items, 'report_id');
  const invoicesBy = groupBy(invoices, 'report_id');
  const approvalsBy = groupBy(approvals, 'report_id');
  const paymentsBy = groupBy(payments, 'report_id');

  return {
    filters: filter,
    reports: reportRows.map((row: any) => ({
      id: row.id,
      serialNo: row.serial_no,
      title: row.title,
      applicant: row.applicant_name,
      department: row.department,
      totalAmount: Number(row.total_amount),
      status: row.status,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      completedAt: row.completed_at,
      items: (itemsBy.get(row.id) ?? []).map(mapItem),
      invoices: (invoicesBy.get(row.id) ?? []).map(mapInvoice),
      approvals: (approvalsBy.get(row.id) ?? []).map(mapApproval),
      payment: mapPayment(paymentsBy.get(row.id)?.[0]),
    })),
  };
}

async function queryByIds(client: any, sql: string, ids: string[]): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const result = await client.query(sql, [ids.slice(offset, offset + 1000)]);
    rows.push(...result.rows);
  }
  return rows;
}

function groupBy(rows: any[], key: string): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
}

function mapItem(row: any) {
  return {
    id: row.id,
    category: row.category_name ?? row.category_id,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    description: row.description,
  };
}

function mapInvoice(row: any) {
  const ocr = row.ocr_result ?? {};
  return {
    id: row.id,
    invoiceNo: row.invoice_no ?? ocr.invoiceNo ?? null,
    amount: ocr.amount ?? ocr.totalAmount ?? null,
    invoiceDate: ocr.invoiceDate ?? ocr.date ?? null,
    sellerName: ocr.sellerName ?? ocr.seller ?? null,
    fileName: row.file_name,
    storageKey: row.storage_key,
    storageBucket: row.storage_bucket,
    checksum: row.checksum,
    verificationStatus: row.verification_status,
  };
}

function mapApproval(row: any) {
  return {
    id: row.id,
    step: row.step,
    approverName: row.approver_name ?? row.approver_id,
    result: row.result,
    comment: row.comment,
    approvedAt: row.approved_at,
  };
}

function mapPayment(row: any) {
  if (!row) return null;
  return {
    paidAt: row.paid_at,
    paidByName: row.paid_by_name,
    paymentRef: row.payment_ref,
    paymentComment: row.payment_comment,
    receipt: row.file_name
      ? {
          fileName: row.file_name,
          storageKey: row.storage_key,
          storageBucket: row.storage_bucket,
          checksum: row.checksum,
          verificationStatus: row.verification_status,
          uploadedAt: row.uploaded_at,
        }
      : null,
  };
}

export function buildCsv(dataset: any): string {
  const headers = [
    '编号', '标题', '申请人', '部门', '金额', '状态', '创建时间', '提交时间', '完成时间',
    '付款时间', '付款参考号', '付款备注', '明细', '发票', '审批链', '付款',
  ];
  const lines = [headers.join(',')];
  for (const report of dataset.reports) {
    lines.push([
      csvCell(report.serialNo), csvCell(report.title), csvCell(report.applicant),
      csvCell(report.department), csvCell(report.totalAmount), csvCell(report.status),
      csvCell(report.createdAt), csvCell(report.submittedAt), csvCell(report.completedAt),
      csvCell(report.payment?.paidAt), csvCell(report.payment?.paymentRef),
      csvCell(report.payment?.paymentComment),
      csvCell(JSON.stringify(report.items)), csvCell(JSON.stringify(report.invoices)),
      csvCell(JSON.stringify(report.approvals)), csvCell(JSON.stringify(report.payment)),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildJson(dataset: any): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), ...dataset }, null, 2);
}

export async function buildXlsx(dataset: any): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const addSheet = (name: string, headers: string[], rows: any[][]) => {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };
  addSheet('报销单', ['编号', '标题', '申请人', '部门', '金额', '状态', '创建时间', '提交时间', '完成时间'],
    dataset.reports.map((r: any) => [r.serialNo, r.title, r.applicant, r.department, r.totalAmount, r.status, r.createdAt, r.submittedAt, r.completedAt]));
  addSheet('费用明细', ['报销编号', '类别', '金额', '费用日期', '说明'],
    dataset.reports.flatMap((r: any) => r.items.map((i: any) => [r.serialNo, i.category, i.amount, i.expenseDate, i.description])));
  addSheet('发票', ['报销编号', '发票号', '金额', '发票日期', '销方', '文件', '存储键'],
    dataset.reports.flatMap((r: any) => r.invoices.map((i: any) => [r.serialNo, i.invoiceNo, i.amount, i.invoiceDate, i.sellerName, i.fileName, i.storageKey])));
  addSheet('审批链', ['报销编号', '步骤', '审批人', '结果', '意见', '时间'],
    dataset.reports.flatMap((r: any) => r.approvals.map((a: any) => [r.serialNo, a.step, a.approverName, a.result, a.comment, a.approvedAt])));
  addSheet('付款', ['报销编号', '付款时间', '付款人', '参考号', '备注', '回单文件', '回单校验'],
    dataset.reports.map((r: any) => [r.serialNo, r.payment?.paidAt, r.payment?.paidByName, r.payment?.paymentRef, r.payment?.paymentComment, r.payment?.receipt?.fileName, r.payment?.receipt?.checksum]));
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}
