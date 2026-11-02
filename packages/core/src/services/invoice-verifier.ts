import type {
  DuplicateInvoiceRef,
  InvoiceVerificationSummary,
  OcrResult,
  VerificationCheck,
  VerificationStatus,
  VerifiedInvoiceView,
} from '@sse/shared';

export type VerificationSourceItem = {
  id: string;
  amount: number;
  expenseDate?: string;
};

export type VerificationSourceInvoice = {
  id: string;
  itemId: string;
  fileName?: string;
  ocrResult?: OcrResult | null;
  ocrError?: string;
  duplicates?: DuplicateInvoiceRef[];
};

export type VerifyInvoicesInput = {
  reportTotal: number;
  items: VerificationSourceItem[];
  invoices: VerificationSourceInvoice[];
  tolerance?: number;
  dateToleranceDays?: number;
};

const DEFAULT_TOLERANCE = 0.01;
const DEFAULT_DATE_TOLERANCE_DAYS = 7;

export function aggregateVerificationStatus(statuses: string[]): VerificationStatus {
  if (statuses.length === 0) return 'no_invoices';
  if (statuses.some((status) => status === 'warning')) return 'warning';
  if (statuses.some((status) => status === 'error')) return 'error';
  if (statuses.some((status) => status === 'unverified' || status === 'pending')) return 'unverified';
  return 'pass';
}

export function verifyInvoices(input: VerifyInvoicesInput): InvoiceVerificationSummary {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const dateToleranceDays = input.dateToleranceDays ?? DEFAULT_DATE_TOLERANCE_DAYS;
  const checkedAt = new Date().toISOString();

  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  const itemTotals = buildItemTotals(input.invoices);

  const views: VerifiedInvoiceView[] = [];
  const itemChecks = new Map<string, VerificationCheck>();
  const reportChecks: VerificationCheck[] = [];
  let missingAmounts = 0;

  for (const invoice of input.invoices) {
    const duplicates = invoice.duplicates ?? [];
    const ocr = invoice.ocrResult ?? null;

    if (!ocr) {
      missingAmounts++;
      views.push({
        invoiceId: invoice.id,
        itemId: invoice.itemId,
        fileName: invoice.fileName ?? '',
        status: 'unverified',
        checks: [],
        duplicates,
        message: invoice.ocrError || '未识别到发票信息',
      });
      continue;
    }

    const amount = getInvoiceAmount(ocr);
    const checks: VerificationCheck[] = [];
    const item = itemsById.get(invoice.itemId);

    if (amount === undefined) {
      missingAmounts++;
      checks.push({
        key: 'amount',
        label: '发票金额',
        ok: false,
        severity: 'warning',
        message: '未识别到发票金额',
      });
    } else if (item) {
      const itemCheck = itemChecks.get(item.id) ?? {
        key: 'item_amount',
        label: '发票金额与明细一致',
        ok: withinTolerance(itemTotals.get(item.id) ?? amount, item.amount, tolerance),
        severity: 'error' as const,
        expected: roundMoney(item.amount),
        actual: roundMoney(itemTotals.get(item.id) ?? amount),
        message: withinTolerance(itemTotals.get(item.id) ?? amount, item.amount, tolerance)
          ? undefined
          : `明细金额 ¥${item.amount.toFixed(2)}，发票合计 ¥${(itemTotals.get(item.id) ?? amount).toFixed(2)}`,
      };
      itemChecks.set(item.id, itemCheck);
      checks.push(itemCheck);
    }

    checks.push({
      key: 'invoice_no',
      label: '发票号码',
      ok: !!ocr.invoiceNo,
      severity: 'warning',
      actual: ocr.invoiceNo,
      message: ocr.invoiceNo ? undefined : '未识别到发票号码',
    });

    if (duplicates.length > 0) {
      checks.push({
        key: 'duplicate',
        label: '重复发票',
        ok: false,
        severity: 'warning',
        actual: duplicates.length,
        message: `发现 ${duplicates.length} 张相同发票号的其他发票记录`,
      });
    }

    const dateCheck = buildDateCheck(ocr.invoiceDate, item?.expenseDate, dateToleranceDays);
    if (dateCheck) checks.push(dateCheck);

    const failed = checks.filter((check) => !check.ok && check.severity !== 'info');
    const status: VerificationStatus = failed.length > 0 ? 'warning' : 'pass';

    views.push({
      invoiceId: invoice.id,
      itemId: invoice.itemId,
      fileName: invoice.fileName ?? '',
      status,
      invoiceNo: ocr.invoiceNo,
      totalAmount: amount,
      checks,
      duplicates,
      message: failed.length > 0 ? failed.map((check) => check.message).filter(Boolean).join('；') : '核对通过',
    });
  }

  if (input.invoices.length === 0) {
    return {
      status: 'no_invoices',
      checkedAt,
      summary: '暂无发票附件',
      counts: { total: 0, pass: 0, warning: 0, unverified: 0, pending: 0 },
      checks: [],
      invoices: [],
    };
  }

  const invoiceAmountSum = input.invoices.reduce((sum, invoice) => {
    const amount = invoice.ocrResult ? getInvoiceAmount(invoice.ocrResult) : undefined;
    return sum + (amount ?? 0);
  }, 0);

  if (missingAmounts > 0) {
    reportChecks.push({
      key: 'report_total',
      label: '整单合计',
      ok: false,
      severity: 'info',
      message: '部分发票未识别金额，无法核对整单合计',
    });
  } else {
    const totalOk = withinTolerance(invoiceAmountSum, input.reportTotal, tolerance);
    reportChecks.push({
      key: 'report_total',
      label: '整单合计',
      ok: totalOk,
      severity: totalOk ? 'info' : 'warning',
      expected: roundMoney(input.reportTotal),
      actual: roundMoney(invoiceAmountSum),
      message: totalOk
        ? undefined
        : `报销单总额 ¥${input.reportTotal.toFixed(2)}，发票合计 ¥${invoiceAmountSum.toFixed(2)}`,
    });
  }

  const statuses = views.map((view) => view.status);
  if (reportChecks.some((check) => !check.ok && check.severity === 'warning')) {
    statuses.push('warning');
  }
  const status = aggregateVerificationStatus(statuses);

  const counts = {
    total: views.length,
    pass: views.filter((view) => view.status === 'pass').length,
    warning: views.filter((view) => view.status === 'warning').length,
    unverified: views.filter((view) => view.status === 'unverified').length,
    pending: 0,
  };

  return {
    status,
    checkedAt,
    summary: buildSummary(status, counts, reportChecks),
    counts,
    checks: reportChecks,
    invoices: views,
  };
}

function buildItemTotals(invoices: VerificationSourceInvoice[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    if (!invoice.ocrResult) continue;
    const amount = getInvoiceAmount(invoice.ocrResult);
    if (amount === undefined) continue;
    totals.set(invoice.itemId, (totals.get(invoice.itemId) ?? 0) + amount);
  }
  return totals;
}

function getInvoiceAmount(ocr: OcrResult): number | undefined {
  const value = ocr.totalAmount ?? ocr.amount;
  return value === undefined || value === null || Number.isNaN(Number(value)) ? undefined : Number(value);
}

function withinTolerance(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance + 1e-6;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildDateCheck(
  invoiceDate?: string,
  itemDate?: string,
  toleranceDays = DEFAULT_DATE_TOLERANCE_DAYS,
): VerificationCheck | null {
  const invoiceTime = parseLooseDate(invoiceDate);
  const itemTime = parseLooseDate(itemDate);
  if (invoiceTime === null || itemTime === null) return null;

  const days = Math.abs(invoiceTime - itemTime) / (24 * 60 * 60 * 1000);
  const ok = days <= toleranceDays;
  return {
    key: 'invoice_date',
    label: '发票日期与明细日期',
    ok,
    severity: 'warning',
    expected: itemDate,
    actual: invoiceDate,
    message: ok ? undefined : `发票日期与明细日期相差 ${Math.round(days)} 天`,
  };
}

function parseLooseDate(value?: string): number | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/年|月/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-');
  const time = new Date(normalized).getTime();
  return Number.isNaN(time) ? null : time;
}

function buildSummary(
  status: VerificationStatus,
  counts: InvoiceVerificationSummary['counts'],
  checks: VerificationCheck[],
): string {
  if (status === 'pass') return '全部发票核对通过';
  if (status === 'no_invoices') return '暂无发票附件';

  const parts: string[] = [];
  if (counts.warning > 0) parts.push(`${counts.warning} 张发票核对存在差异`);
  if (counts.unverified > 0) parts.push(`${counts.unverified} 张发票未识别`);
  if (checks.some((check) => !check.ok && check.severity === 'warning')) parts.push('整单合计不一致');
  return parts.length > 0 ? parts.join('，') : '核对未通过';
}
