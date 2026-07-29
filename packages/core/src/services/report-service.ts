import type { ExpenseReport, CreateReportDto } from '@sse/shared';
import type { IExpenseRepo } from '../ports/iexpense-repo';
import type { IApprovalRuleRepo } from '../ports/iapproval-rule-repo';
import type { IApprovalRecordRepo } from '../ports/iapproval-record-repo';
import { ApprovalEngine } from './approval-engine';
import { generateSerialNo } from '../utils';

export class ReportService {
  private readonly engine: ApprovalEngine;

  constructor(
    private readonly expenseRepo: IExpenseRepo,
    private readonly ruleRepo: IApprovalRuleRepo,
    private readonly recordRepo: IApprovalRecordRepo,
  ) {
    this.engine = new ApprovalEngine(ruleRepo, recordRepo);
  }

  async submitReport(dto: CreateReportDto, userId: string): Promise<ExpenseReport> {
    const serialNo = generateSerialNo();
    const report = await this.expenseRepo.create(dto, userId, serialNo);
    return report;
  }
}
