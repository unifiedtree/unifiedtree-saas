import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Invoice,
  CreateInvoiceRequest,
  PaginatedResponse,
  ApiResponse,
  PaginationParams,
  FilterParams,
  InvoiceStatus,
} from '@erp/types'
import { useApi } from '../context/ApiContext'

type InvoiceFilters = PaginationParams &
  FilterParams & {
    status?: InvoiceStatus
    clientName?: string
    from?: string
    to?: string
  }

const QUERY_KEYS = {
  all: (tenantId: string) => ['invoices', tenantId] as const,
  list: (tenantId: string, params: InvoiceFilters) =>
    ['invoices', tenantId, 'list', params] as const,
  detail: (tenantId: string, id: string) => ['invoices', tenantId, id] as const,
}

export function useInvoices(tenantId: string, params: InvoiceFilters = {}) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.list(tenantId, params),
    queryFn: () =>
      client.get<ApiResponse<PaginatedResponse<Invoice>>>(
        `/api/v1/tenants/${tenantId}/accounts/invoices`,
        params
      ),
    enabled: Boolean(tenantId),
  })
}

export function useInvoice(tenantId: string, id: string) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.detail(tenantId, id),
    queryFn: () =>
      client.get<ApiResponse<Invoice>>(`/api/v1/tenants/${tenantId}/accounts/invoices/${id}`),
    enabled: Boolean(tenantId) && Boolean(id),
  })
}

export function useCreateInvoice(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateInvoiceRequest) =>
      client.post<ApiResponse<Invoice>>(`/api/v1/tenants/${tenantId}/accounts/invoices`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}

export function useUpdateInvoice(tenantId: string, id: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Partial<CreateInvoiceRequest>) =>
      client.patch<ApiResponse<Invoice>>(
        `/api/v1/tenants/${tenantId}/accounts/invoices/${id}`,
        data
      ),
    onSuccess: (response) => {
      queryClient.setQueryData(QUERY_KEYS.detail(tenantId, id), response)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}

export function useSendInvoice(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (invoiceId: string) =>
      client.post<ApiResponse<Invoice>>(
        `/api/v1/tenants/${tenantId}/accounts/invoices/${invoiceId}/send`
      ),
    onSuccess: (_data, invoiceId) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.detail(tenantId, invoiceId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}

export function useMarkInvoicePaid(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ invoiceId, paidDate }: { invoiceId: string; paidDate: string }) =>
      client.patch<ApiResponse<Invoice>>(
        `/api/v1/tenants/${tenantId}/accounts/invoices/${invoiceId}/paid`,
        { paidDate }
      ),
    onSuccess: (_data, { invoiceId }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.detail(tenantId, invoiceId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}
