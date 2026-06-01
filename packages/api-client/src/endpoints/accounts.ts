import { apiClient } from '../ApiClient'

export const accountsApi = {
  getInvoices: (p?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/accounts/invoices', p),

  createInvoice: (data: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>('/api/v1/accounts/invoices', data),

  getPayments: (p?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/accounts/payments', p),

  getExpenses: (p?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/accounts/expenses', p),

  approveExpense: (id: string) =>
    apiClient.patch<Record<string, unknown>>(`/api/v1/accounts/expenses/${id}/approve`, {}),
}
