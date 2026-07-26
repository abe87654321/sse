import type { ExpenseExtraction, ActionResult } from './types';

export class ActionReasoner {
  async reason(extraction: ExpenseExtraction): Promise<{ valid: boolean; error?: ActionResult['error']; dto?: any }> {
    if (!extraction.person?.matchedUserId) {
      return { valid: false, error: { step: 'reason', code: 'COULD_NOT_RESOLVE_USER', detail: `未在系统中找到用户 "${extraction.person?.name}"`, suggestion: '请确认姓名或手机号，或让管理员添加该用户' } };
    }
    if (!extraction.amount || extraction.amount <= 0) {
      return { valid: false, error: { step: 'reason', code: 'INVALID_AMOUNT', detail: '报销金额无效或为0' } };
    }
    if (!extraction.categoryId) {
      return { valid: false, error: { step: 'reason', code: 'UNKNOWN_CATEGORY', detail: `无法匹配费用类别 "${extraction.category}"`, suggestion: '请使用系统已知的费用类别' } };
    }
    const dto = {
      title: extraction.description || '自动创建报销',
      items: [{
        categoryId: extraction.categoryId,
        amount: extraction.amount,
        expenseDate: extraction.date || new Date().toISOString().slice(0, 10),
        description: extraction.description || '',
      }],
    };
    return { valid: true, dto };
  }
}
