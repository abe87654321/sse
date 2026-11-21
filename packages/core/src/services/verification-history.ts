import type { VerificationHistoryKind, VerificationRun } from '@sse/shared';

const RESTRICTED_MARKER = [{ restricted: true }];

function redactItemResult(
  result: Record<string, unknown>,
  kind: VerificationHistoryKind
): Record<string, unknown> {
  if (!result || typeof result !== 'object') return result;
  const clone = { ...result };

  if (kind === 'invoice' && Array.isArray(result.duplicates)) {
    clone.duplicates = result.duplicates.length > 0 ? RESTRICTED_MARKER : [];
  }
  if (kind === 'payment_receipt' && Array.isArray(result.duplicateReceipts)) {
    clone.duplicateReceipts =
      result.duplicateReceipts.length > 0 ? RESTRICTED_MARKER : [];
  }

  return clone;
}

export function redactVerificationHistory(
  run: VerificationRun,
  options: { canSeeDuplicates: boolean; canSeeReceipts: boolean }
): VerificationRun | null {
  if (run.kind === 'payment_receipt' && !options.canSeeReceipts) return null;
  if (options.canSeeDuplicates) return run;

  return {
    ...run,
    items: run.items.map((item) => ({
      ...item,
      result: redactItemResult(item.result, item.kind),
    })),
  };
}
