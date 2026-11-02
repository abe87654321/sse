import type {
  OcrResult,
  PaymentDuplicateReceiptRef,
  PaymentReceiptStatus,
  PaymentReceiptVerification,
  VerificationCheck,
} from '@sse/shared';

export type VerifyPaymentReceiptInput = {
  reportTotal: number;
  paidAt?: string | Date | null;
  ocrResult?: OcrResult | null;
  ocrError?: string;
  duplicateReceipts?: PaymentDuplicateReceiptRef[];
  tolerance?: number;
  dateToleranceDays?: number;
};

const DEFAULT_TOLERANCE = 0.01;
const DEFAULT_DATE_TOLERANCE_DAYS = 7;
const NEGATIVE_KEYWORDS = ['失败', '退回', '冲正', '撤销', '处理中'];

export function aggregatePaymentReceiptStatus(statuses: string[]): PaymentReceiptStatus {
  if (statuses.length === 0) return 'unverified';
  if (statuses.some((status) => status === 'warning')) return 'warning';
  if (statuses.some((status) => status === 'error')) return 'error';
  if (statuses.some((status) => status === 'unverified' || status === 'pending')) return 'unverified';
  return 'pass';
}

export function verifyPaymentReceipt(input: VerifyPaymentReceiptInput): PaymentReceiptVerification {
  const checkedAt = new Date().toISOString();
  const duplicates = input.duplicateReceipts ?? [];
  const ocr = input.ocrResult ?? null;

  if (!ocr) {
    return {
      status: 'unverified',
      checks: [
        {
          key: 'ocr',
          label: '回单识别',
          ok: false,
          severity: 'warning',
          message: input.ocrError || '未获取到回单 OCR 结果',
        },
      ],
      summary: input.ocrError || '未获取到回单 OCR 结果',
      checkedAt,
      duplicateReceipts: duplicates,
    };
  }

  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const dateToleranceDays = input.dateToleranceDays ?? DEFAULT_DATE_TOLERANCE_DAYS;
  const checks: VerificationCheck[] = [];

  const amount = getReceiptAmount(ocr);
  if (amount === undefined) {
    checks.push({
      key: 'amount',
      label: '回单金额',
      ok: false,
      severity: 'warning',
      message: '未识别到打款金额',
    });
  } else {
    const ok = withinTolerance(amount, input.reportTotal, tolerance);
    checks.push({
      key: 'amount_match',
      label: '打款金额与报销金额一致',
      ok,
      severity: 'warning',
      expected: roundMoney(input.reportTotal),
      actual: roundMoney(amount),
      message: ok
        ? undefined
        : `报销金额 ¥${input.reportTotal.toFixed(2)}，回单金额 ¥${amount.toFixed(2)}`,
    });
  }

  if (duplicates.length > 0) {
    checks.push({
      key: 'duplicate_receipt',
      label: '重复打款回单',
      ok: false,
      severity: 'warning',
      actual: duplicates.length,
      message: `发现 ${duplicates.length} 份相同回单`,
    });
  }

  checks.push(...buildDateChecks(ocr.invoiceDate, input.paidAt, dateToleranceDays));

  const negative = findNegativeKeyword(ocr.rawText);
  if (negative) {
    checks.push({
      key: 'negative_keyword',
      label: '回单文本风险词',
      ok: false,
      severity: 'warning',
      message: `检测到“${negative}”，请人工复核`,
    });
  }

  const failed = checks.filter((check) => !check.ok && check.severity !== 'info');
  const status: PaymentReceiptStatus = failed.length > 0 ? 'warning' : 'pass';

  return {
    status,
    checks,
    summary:
      failed.length > 0
        ? failed.map((check) => check.message).filter(Boolean).join('；')
        : '打款回单核对通过',
    checkedAt,
    ocr,
    duplicateReceipts: duplicates,
  };
}

function getReceiptAmount(ocr: OcrResult): number | undefined {
  const value = ocr.totalAmount ?? ocr.amount;
  return value === undefined || value === null || Number.isNaN(Number(value)) ? undefined : Number(value);
}

function withinTolerance(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance + 1e-6;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildDateChecks(
  receiptDate?: string,
  paidAt?: string | Date | null,
  toleranceDays = DEFAULT_DATE_TOLERANCE_DAYS
): VerificationCheck[] {
  if (!receiptDate) {
    return [
      {
        key: 'receipt_date',
        label: '回单日期',
        ok: false,
        severity: 'warning',
        message: '未识别到回单日期',
      },
    ];
  }

  const receiptTime = parseLooseDate(receiptDate);
  const paidTime = parseLooseDate(paidAt);
  if (receiptTime === null || paidTime === null) return [];

  const days = Math.abs(receiptTime - paidTime) / (24 * 60 * 60 * 1000);
  const ok = days <= toleranceDays;
  return [
    {
      key: 'receipt_date',
      label: '回单日期与打款日期',
      ok,
      severity: 'warning',
      expected: toDateString(paidAt),
      actual: receiptDate,
      message: ok ? undefined : `回单日期与打款日期相差 ${Math.round(days)} 天`,
    },
  ];
}

function findNegativeKeyword(rawText?: string): string | undefined {
  if (!rawText) return undefined;
  return NEGATIVE_KEYWORDS.find((keyword) => rawText.includes(keyword));
}

function parseLooseDate(value?: string | Date | null): number | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();

  const trimmed = value.trim();
  const direct = new Date(trimmed).getTime();
  if (!Number.isNaN(direct)) return direct;

  const normalized = trimmed
    .replace(/年|月/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-');
  const time = new Date(normalized).getTime();
  return Number.isNaN(time) ? null : time;
}

function toDateString(value?: string | Date | null): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}
