import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.compliance.enums
export type ComplianceStatus = 'PENDING' | 'DONE' | 'OVERDUE'
export type FilingType = 'PF' | 'ESI' | 'TDS' | 'PT' | 'GRATUITY' | 'OTHER'
export type FilingStatus = 'DUE' | 'FILED' | 'LATE'
export type PoshStatus = 'RECEIVED' | 'UNDER_INQUIRY' | 'RESOLVED' | 'DISMISSED'

export const FILING_TYPES: FilingType[] = ['PF', 'ESI', 'TDS', 'PT', 'GRATUITY', 'OTHER']
export const POSH_STATUSES: PoshStatus[] = ['RECEIVED', 'UNDER_INQUIRY', 'RESOLVED', 'DISMISSED']
export const POSH_SEVERITIES: string[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export interface ComplianceItem {
  id: string
  companyId: string
  title: string
  category?: string
  dueDate: string
  status: ComplianceStatus
  frequency?: string
  ownerId?: string
  ownerName?: string
  ownerCode?: string
  notes?: string
  createdAt: string
}

export interface StatutoryFiling {
  id: string
  companyId: string
  filingType: FilingType
  period?: string
  amount?: number | null
  dueDate: string
  filedDate?: string
  status: FilingStatus
  referenceNo?: string
  createdAt: string
}

export interface PoshComplaint {
  id: string
  companyId: string
  complaintNo: string
  filedDate: string
  severity?: string
  status: PoshStatus
  description?: string
  resolution?: string
  resolvedDate?: string
  createdAt: string
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

export const inr = (n?: number | null) =>
  '₹' + (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// ── Compliance calendar ──────────────────────────────────────────────────────

export function useComplianceItems(companyId?: string, page = 0) {
  return useQuery({
    queryKey: ['hrms', 'compliance', 'items', companyId, page],
    queryFn: () =>
      apiJson<Page<ComplianceItem>>(
        `/v1/compliance/items?${companyId ? `companyId=${companyId}&` : ''}page=${page}&size=50`,
      ),
    staleTime: 30_000,
  })
}

export interface ComplianceItemPayload {
  companyId?: string
  title: string
  category?: string
  dueDate: string
  frequency?: string
  ownerId?: string
  notes?: string
}

export function useCreateComplianceItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ComplianceItemPayload) =>
      apiJson<ComplianceItem>('/v1/compliance/items', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'items'] }),
  })
}

export function useMarkComplianceDone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<ComplianceItem>(`/v1/compliance/items/${id}/done`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'items'] }),
  })
}

// ── Statutory filings ────────────────────────────────────────────────────────

export function useStatutoryFilings(companyId?: string, page = 0) {
  return useQuery({
    queryKey: ['hrms', 'compliance', 'filings', companyId, page],
    queryFn: () =>
      apiJson<Page<StatutoryFiling>>(
        `/v1/compliance/filings?${companyId ? `companyId=${companyId}&` : ''}page=${page}&size=50`,
      ),
    staleTime: 30_000,
  })
}

export interface FilingPayload {
  companyId?: string
  filingType: FilingType
  period?: string
  amount?: number | null
  dueDate: string
}

export function useCreateFiling() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: FilingPayload) =>
      apiJson<StatutoryFiling>('/v1/compliance/filings', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'filings'] }),
  })
}

export function useFileFiling() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, referenceNo }: { id: string; referenceNo?: string }) =>
      apiJson<StatutoryFiling>(`/v1/compliance/filings/${id}/file`, {
        method: 'POST',
        body: JSON.stringify({ referenceNo }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'filings'] }),
  })
}

// ── POSH register (sensitive) ────────────────────────────────────────────────

export function usePoshComplaints(companyId?: string, page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'compliance', 'posh', companyId, page],
    queryFn: () =>
      apiJson<Page<PoshComplaint>>(
        `/v1/compliance/posh?${companyId ? `companyId=${companyId}&` : ''}page=${page}&size=50`,
      ),
    staleTime: 15_000,
    enabled,
  })
}

export interface PoshComplaintPayload {
  companyId?: string
  complaintNo?: string
  filedDate: string
  severity?: string
  description?: string
}

export function useCreatePoshComplaint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PoshComplaintPayload) =>
      apiJson<PoshComplaint>('/v1/compliance/posh', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'posh'] }),
  })
}

export function useUpdatePoshStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, resolution }: { id: string; status: PoshStatus; resolution?: string }) =>
      apiJson<PoshComplaint>(`/v1/compliance/posh/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, resolution }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'compliance', 'posh'] }),
  })
}
