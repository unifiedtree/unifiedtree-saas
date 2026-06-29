import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

// Mirrors backend com.hrms.document.enums.DocumentCategory
export type DocumentCategory =
  | 'CONTRACT' | 'ID_PROOF' | 'CERTIFICATE' | 'PAYSLIP' | 'POLICY' | 'TAX' | 'OTHER'

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'CONTRACT', 'ID_PROOF', 'CERTIFICATE', 'PAYSLIP', 'POLICY', 'TAX', 'OTHER',
]

export interface EmployeeDocument {
  id: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  companyId: string
  title: string
  category: DocumentCategory
  fileUrl: string
  issuedDate?: string
  expiryDate?: string
  notes?: string
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

// ── My documents ─────────────────────────────────────────────────────────────

export function useMyDocuments(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'document', 'my', page],
    queryFn: () => apiJson<Page<EmployeeDocument>>(`/v1/document/my?page=${page}&size=20`),
    staleTime: 30_000,
  })
}

export function useEmployeeDocuments(employeeId: string | undefined, page = 0, enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'document', 'employee', employeeId, page],
    queryFn: () => apiJson<Page<EmployeeDocument>>(`/v1/document/employee/${employeeId}?page=${page}&size=20`),
    enabled: !!employeeId && enabled,
    staleTime: 15_000,
  })
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'document', 'one', id],
    queryFn: () => apiJson<EmployeeDocument>(`/v1/document/documents/${id}`),
    enabled: !!id,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface CreateDocumentPayload {
  employeeId: string
  companyId?: string
  title: string
  category: DocumentCategory
  fileUrl: string
  issuedDate?: string
  expiryDate?: string
  notes?: string
}

export function useCreateDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateDocumentPayload) =>
      apiJson<EmployeeDocument>('/v1/document/documents', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document'] }),
  })
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/document/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document'] }),
  })
}
