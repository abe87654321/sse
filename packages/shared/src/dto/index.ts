export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginationResult {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface ApiError {
  code: 'NOT_FOUND' | 'INVALID_PARAMS' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
  message: string;
  retryAfterSeconds?: number;
}

export interface PaginatedResponse<T> {
  results: T[];
  pagination: PaginationResult;
}

export interface CreateReportDto {
  title: string;
  description?: string;
  items: Array<{
    categoryId: string;
    amount: number;
    expenseDate: string;
    description: string;
  }>;
}

export interface SearchExpensesQuery extends PaginationParams {
  dateFrom?: string;
  dateTo?: string;
  applicantId?: string;
  status?: string;
  categoryId?: string;
  amountMin?: number;
  amountMax?: number;
  keyword?: string;
}

export interface StatisticsQuery {
  dateFrom?: string;
  dateTo?: string;
  department?: string;
}
