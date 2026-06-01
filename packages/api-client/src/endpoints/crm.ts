import { apiClient } from '../ApiClient'

export const crmApi = {
  getLeads: (p?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/crm/leads', p),

  createLead: (data: Record<string, unknown>) =>
    apiClient.post<Record<string, unknown>>('/api/v1/crm/leads', data),

  updateLead: (id: string, data: Record<string, unknown>) =>
    apiClient.put<Record<string, unknown>>(`/api/v1/crm/leads/${id}`, data),

  getCustomers: (p?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/crm/customers', p),

  getDeals: (p?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/crm/deals', p),

  updateDealStage: (id: string, stage: string) =>
    apiClient.patch<Record<string, unknown>>(`/api/v1/crm/deals/${id}/stage`, { stage }),
}
