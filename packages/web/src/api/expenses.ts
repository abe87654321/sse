import api from './index'

export interface Expense {
  id: string
  serialNo: string
  title: string
  amount: number
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'paid'
  category: string
  description: string
  items: ExpenseItem[]
  attachments: string[]
  createdAt: string
  updatedAt: string
  submittedBy: string
  approvedBy?: string
  paidAt?: string
}

export interface ExpenseItem {
  id: string
  name: string
  amount: number
  quantity: number
  unit: string
}

export const expenseApi = {
  list(params?: { status?: string; keyword?: string; page?: number; pageSize?: number }) {
    return api.get<{ data: Expense[]; total: number }>('/expenses', { params })
  },
  detail(id: string) {
    return api.get<Expense>(`/expenses/${id}`)
  },
  create(data: Partial<Expense>) {
    return api.post<Expense>('/expenses', data)
  },
  update(id: string, data: Partial<Expense>) {
    return api.put<Expense>(`/expenses/${id}`, data)
  },
  submit(id: string) {
    return api.post(`/expenses/${id}/submit`)
  },
  approve(id: string, data: { approved: boolean; comment?: string }) {
    return api.post(`/expenses/${id}/approve`, data)
  }
}
