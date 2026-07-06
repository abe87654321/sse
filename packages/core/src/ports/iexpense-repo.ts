import type { ExpenseReport, CreateReportDto } from '@sse/shared';

export interface ExpenseQuery {
  dateFrom?: string;
  dateTo?: string;
  applicantId?: string;
  status?: string;
  categoryId?: string;
  amountMin?: number;
  amountMax?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface IExpenseRepo {
  findById(id: string): Promise<ExpenseReport | null>;
  findMany(query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }>;
  findManyByApprover(approverId: string, page: number, pageSize: number): Promise<{ results: ExpenseReport[]; total: number }>;
  findManyByUser(userId: string, query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }>;
  create(dto: CreateReportDto, userId: string, serialNo: string): Promise<ExpenseReport>;
  updateStatus(id: string, status: string, currentStep?: number): Promise<void>;
  getStatistics(dateFrom?: string, dateTo?: string, department?: string): Promise<any>;
  getUserSummary(userId: string, dateFrom?: string, dateTo?: string): Promise<any>;
}
