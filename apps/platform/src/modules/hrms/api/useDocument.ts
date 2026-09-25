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

/**
 * Rows per page for both vault lists. Exported so the pager's "Showing 1–20 of
 * N" is computed from the size we actually put on the query string — a literal
 * at the call site would silently start lying the day this number changes.
 * DocumentController declares @PageableDefault(size = 20) for both endpoints.
 */
export const DOCUMENT_PAGE_SIZE = 20

export function useMyDocuments(page = 0, pageSize = DOCUMENT_PAGE_SIZE) {
  return useQuery({
    // `page` is part of the key: without it react-query would hand page 2 the
    // cached page-1 rows and the table would never appear to advance.
    queryKey: ['hrms', 'document', 'my', page, pageSize],
    queryFn: () => apiJson<Page<EmployeeDocument>>(`/v1/document/my?page=${page}&size=${pageSize}`),
    staleTime: 30_000,
  })
}

export function useEmployeeDocuments(employeeId: string | undefined, page = 0, enabled = true, pageSize = DOCUMENT_PAGE_SIZE) {
  return useQuery({
    queryKey: ['hrms', 'document', 'employee', employeeId, page, pageSize],
    queryFn: () => apiJson<Page<EmployeeDocument>>(`/v1/document/employee/${employeeId}?page=${page}&size=${pageSize}`),
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
  file?: File
  employeeId: string
  companyId?: string
  title: string
  category: DocumentCategory
  fileUrl: string
  issuedDate?: string
  expiryDate?: string
  notes?: string
  /** V143.7 typed upload (file uploads only): the server checks the type's formats and size. */
  documentTypeId?: string
}

export function useCreateDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateDocumentPayload) => {
      if (data.file) {
        const { file, fileUrl, companyId, ...metadata } = data
        const body = new FormData()
        body.append('file', file)
        body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
        return apiJson<EmployeeDocument>('/v1/document/upload', { method: 'POST', body })
      }
      return apiJson<EmployeeDocument>('/v1/document/documents', { method: 'POST', body: JSON.stringify(data) })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document'] }),
  })
}

// ── V143.13: edit a stored document, and bulk upload ────────────────────────

export interface EditDocumentPayload {
  id: string
  title: string
  category?: DocumentCategory
  /** null = free-form (no type). A new type must be active and fit the kept file. */
  documentTypeId?: string | null
  issuedDate?: string | null
  expiryDate?: string | null
  notes?: string | null
  /** Only for documents stored as a link. */
  fileUrl?: string
  /** Replaces the stored file (the old one is deleted; the new one lands verified). */
  file?: File | null
}

export function useEditDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file, ...metadata }: EditDocumentPayload) => {
      if (file) {
        const body = new FormData()
        body.append('file', file)
        body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
        return apiJson<EmployeeDocumentV2>(`/v1/document/documents/${id}`, { method: 'PUT', body })
      }
      return apiJson<EmployeeDocumentV2>(`/v1/document/documents/${id}`, { method: 'PUT', body: JSON.stringify(metadata) })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document'] }),
  })
}

/**
 * Same category the server derives for a typed self-upload
 * (DocumentUploadController.guessCategory), so a typed HR upload files the same way.
 */
export function categoryForType(code?: string | null): DocumentCategory {
  switch (code) {
    case 'PAN': case 'TAX': return 'TAX'
    case 'AADHAAR': case 'PASSPORT': case 'DRIVING_LICENSE': case 'VOTER_ID': case 'PHOTO': return 'ID_PROOF'
    case 'RESUME': case 'OFFER_LETTER': return 'CONTRACT'
    case 'EDUCATION_CERT': return 'CERTIFICATE'
    default: return 'OTHER'
  }
}

/** The formats a type accepts ('jpg' and 'jpeg' are the same file). */
export function typeFormats(t?: Pick<DocumentType, 'allowedFormats'> | null): string[] {
  return (t?.allowedFormats || 'pdf,png,jpg,jpeg').split(',').map((f) => f.trim().toLowerCase()).filter(Boolean)
}

/** Returns why a file doesn't fit a type's rules, or '' when it does. */
export function fileProblem(file: File, t?: Pick<DocumentType, 'allowedFormats' | 'maxSizeMb' | 'displayName'> | null): string {
  const formats = typeFormats(t)
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const ok = formats.includes(ext) || (ext === 'jpg' && formats.includes('jpeg')) || (ext === 'jpeg' && formats.includes('jpg'))
  if (!ok) return `${t?.displayName ?? 'This type'} takes ${formats.join(', ').toUpperCase()}`
  const maxMb = t?.maxSizeMb ?? 10
  if (file.size > maxMb * 1024 * 1024) return `The file must be ${maxMb} MB or smaller`
  return ''
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/document/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document'] }),
  })
}

// ── V143.7: document types + verification workflow ─────────────────────────

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'

export interface DocumentType {
  id: string
  code: string
  displayName: string
  description?: string | null
  allowedFormats: string
  maxSizeMb: number
  required: boolean
  expiryTracked: boolean
  active: boolean
  sortOrder: number
}

export interface EmployeeDocumentV2 extends EmployeeDocument {
  documentTypeId?: string | null
  documentTypeCode?: string | null
  documentTypeName?: string | null
  verificationStatus?: VerificationStatus | null
  verifiedBy?: string | null
  verifiedAt?: string | null
  rejectionReason?: string | null
  originalFilename?: string | null
  fileSizeBytes?: number | null
  contentType?: string | null
}

export function useDocumentTypes(includeInactive = false) {
  return useQuery({
    queryKey: ['hrms', 'document', 'types', includeInactive],
    queryFn: () => apiJson<DocumentType[]>(`/v1/document/types?includeInactive=${includeInactive}`),
    staleTime: 60_000,
  })
}

export function useMyMissingDocuments() {
  return useQuery({
    queryKey: ['hrms', 'document', 'my', 'missing'],
    queryFn: () => apiJson<Array<{ id: string; code: string; displayName: string; allowedFormats: string; maxSizeMb: number; expiryTracked: boolean }>>(
      '/v1/document/my/missing',
    ),
    staleTime: 30_000,
  })
}

export function usePendingDocumentQueue(enabled = true) {
  return useQuery({
    queryKey: ['hrms', 'document', 'pending'],
    queryFn: () => apiJson<Array<{
      id: string; employeeId: string; employeeName?: string; employeeCode?: string;
      title: string; documentTypeId?: string; documentTypeCode?: string; documentTypeName?: string;
      originalFilename?: string; fileSizeBytes?: number; createdAt: string;
    }>>('/v1/document/pending'),
    enabled,
    staleTime: 15_000,
  })
}

export interface DocumentTypePayload {
  code: string
  displayName: string
  description?: string | null
  allowedFormats: string
  maxSizeMb: number
  required: boolean
  expiryTracked: boolean
  active?: boolean
  sortOrder?: number
}

export function useCreateDocumentType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DocumentTypePayload) =>
      apiJson<{ id: string }>('/v1/document/types', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document', 'types'] }),
  })
}

export function useUpdateDocumentType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: DocumentTypePayload & { id: string }) =>
      apiJson<void>(`/v1/document/types/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document', 'types'] }),
  })
}

export function useDeactivateDocumentType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<void>(`/v1/document/types/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document', 'types'] }),
  })
}

export interface SelfUploadPayload {
  file: File
  documentTypeId: string
  title: string
  issuedDate?: string
  expiryDate?: string
  notes?: string
}

export function useSelfUploadDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SelfUploadPayload) => {
      const { file, ...metadata } = data
      const body = new FormData()
      body.append('file', file)
      body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
      return apiJson<EmployeeDocumentV2>('/v1/document/upload/self', { method: 'POST', body })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document'] }),
  })
}

export function useVerifyDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiJson<EmployeeDocumentV2>(`/v1/document/documents/${id}/verify`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document'] }),
  })
}

export function useRejectDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiJson<EmployeeDocumentV2>(`/v1/document/documents/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'document'] }),
  })
}
