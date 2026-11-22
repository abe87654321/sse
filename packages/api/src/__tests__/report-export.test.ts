import ExcelJS from 'exceljs';
import { buildCsv, buildJson, buildXlsx, loadReportExportDataset } from '../services/report-export';

const dataset = {
  filters: { dateFrom: '2026-11-01', dateTo: '2026-11-30' },
  reports: [{
    id: 'r1', serialNo: 'BX001', title: '出差', applicant: '张三', department: '技术部',
    totalAmount: 100, status: 'approved', createdAt: '2026-11-01T00:00:00.000Z',
    items: [{ id: 'i1', category: '交通', amount: 100, expenseDate: '2026-11-01', description: '高铁' }],
    invoices: [{ id: 'v1', invoiceNo: 'INV1', amount: 100, storageKey: 'invoices/r1/a.pdf' }],
    approvals: [{ id: 'a1', step: 1, approverName: '李四', result: 'approved', comment: 'ok' }],
    payment: { paidAt: '2026-11-02T00:00:00.000Z', paymentRef: 'PAY1', receipt: { fileName: 'r.pdf' } },
  }],
};

test('CSV is BOM-prefixed and includes child JSON columns', () => {
  const csv = buildCsv(dataset as any);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('明细');
  expect(csv).toContain('BX001');
});

test('JSON keeps nested children', () => {
  const json = JSON.parse(buildJson(dataset as any));
  expect(json.reports[0].items[0].category).toBe('交通');
  expect(json.reports[0].payment.receipt.fileName).toBe('r.pdf');
});

test('XLSX has five sheets', async () => {
  const buffer = await buildXlsx(dataset as any);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    '报销单', '费用明细', '发票', '审批链', '付款',
  ]);
});

test('loader caps exports and queries children in batches', async () => {
  const queries: Array<[string, any[]]> = [];
  const client = {
    query: jest.fn(async (sql: string, params: any[]) => {
      queries.push([sql, params]);
      if (sql.includes('FROM expense_reports er')) {
        return {
          rows: [{
            id: 'r1',
            serial_no: 'BX001',
            title: '出差',
            applicant_name: '张三',
            department: '技术部',
            total_amount: '100',
            status: 'approved',
          }],
        };
      }
      return { rows: [] };
    }),
  };
  const result = await loadReportExportDataset(client as any, { userId: 'u1' });
  expect(result.reports).toHaveLength(1);
  expect(queries.some(([sql]) => sql.includes('ANY($1::uuid[])'))).toBe(true);
});
