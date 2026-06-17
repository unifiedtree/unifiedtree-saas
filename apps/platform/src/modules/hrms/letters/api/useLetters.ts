import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson, apiText, apiBlob } from '@/core/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LetterType = 'OFFER' | 'APPOINTMENT' | 'RELIEVING' | 'EXPERIENCE' | 'SALARY_REVISION' | 'CUSTOM'
export type LetterStatus = 'GENERATED' | 'SENT' | 'VIEWED' | 'SIGNED' | 'VOID'

export interface LetterTemplateDto {
  id: string
  tenantId: string
  companyId: string
  name: string
  type: LetterType
  subject: string
  bodyHtml: string
  active: boolean
  variantName?: string
  createdAt: string
  updatedAt: string
  createdBy?: string
}

export interface GeneratedLetterDto {
  id: string
  tenantId: string
  companyId: string
  templateId: string
  employeeId: string
  type: LetterType
  subject: string
  status: LetterStatus
  hasPdf: boolean
  pdfSizeBytes?: number
  sentAt?: string
  sentToEmail?: string
  viewedAt?: string
  voidedAt?: string
  voidedReason?: string
  generatedBy: string
  generationContext?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface MergeFieldEntry {
  key: string
  label: string
  example: string
  category: string
}

export interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

export interface CreateTemplateRequest {
  companyId?: string
  name: string
  type: LetterType
  subject: string
  bodyHtml: string
  active?: boolean
  variantName?: string
}

export interface UpdateTemplateRequest {
  name?: string
  type?: LetterType
  subject?: string
  bodyHtml?: string
  active?: boolean
  variantName?: string
}

export interface GenerateLetterRequest {
  templateId: string
  employeeId: string
  overrides?: Record<string, string>
  sendImmediately?: boolean
  sendToEmail?: string
}

export interface SendLetterRequest {
  toEmail?: string
  ccEmail?: string
}

export interface VoidLetterRequest {
  reason: string
}

// ── Template hooks ────────────────────────────────────────────────────────────

export function useLetterTemplates(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'templates', page],
    queryFn: () =>
      apiJson<PageResponse<LetterTemplateDto>>(`/v1/letters/templates?page=${page}&size=20`),
    staleTime: 60_000,
  })
}

export function useLetterTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'templates', id],
    queryFn: () => apiJson<LetterTemplateDto>(`/v1/letters/templates/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateTemplateRequest) =>
      apiJson<LetterTemplateDto>('/v1/letters/templates', { method: 'POST', body: JSON.stringify(req) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'templates'] }),
  })
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: UpdateTemplateRequest) =>
      apiJson<LetterTemplateDto>(`/v1/letters/templates/${id}`, { method: 'PUT', body: JSON.stringify(req) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'templates'] }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/letters/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'templates'] }),
  })
}

// ── Merge fields ──────────────────────────────────────────────────────────────

export function useMergeFieldsCatalogue() {
  return useQuery({
    queryKey: ['hrms', 'letters', 'merge-fields'],
    queryFn: () => apiJson<MergeFieldEntry[]>('/v1/letters/merge-fields'),
    staleTime: Infinity,
  })
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: ({ templateId, employeeId, overrides }: { templateId: string; employeeId: string; overrides?: Record<string, string> }) =>
      apiText(`/v1/letters/templates/${templateId}/preview`, {
        method: 'POST',
        body: JSON.stringify({ employeeId, overrides }),
      }),
  })
}

// ── Generation hooks ──────────────────────────────────────────────────────────

export function useGenerateLetter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: GenerateLetterRequest) =>
      apiJson<GeneratedLetterDto>('/v1/letters/generate', { method: 'POST', body: JSON.stringify(req) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'generated'] }),
  })
}

export function useGeneratedLetters(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'generated', page],
    queryFn: () =>
      apiJson<PageResponse<GeneratedLetterDto>>(`/v1/letters/generated?page=${page}&size=20`),
    staleTime: 30_000,
  })
}

export function useGeneratedLetter(id: string | undefined) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'generated', id],
    queryFn: () => apiJson<GeneratedLetterDto>(`/v1/letters/generated/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useSendLetter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: SendLetterRequest }) =>
      apiJson<GeneratedLetterDto>(`/v1/letters/generated/${id}/send`, {
        method: 'POST',
        body: JSON.stringify(req),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'generated'] }),
  })
}

export function useVoidLetter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiJson<GeneratedLetterDto>(`/v1/letters/generated/${id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason } satisfies VoidLetterRequest),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'generated'] }),
  })
}

// ── Employee self-service ─────────────────────────────────────────────────────

export function useMyLetters(page = 0) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'my', page],
    queryFn: () =>
      apiJson<PageResponse<GeneratedLetterDto>>(`/v1/letters/my?page=${page}&size=20`),
    staleTime: 30_000,
  })
}

// ── PDF download helper ───────────────────────────────────────────────────────

export async function downloadLetterPdf(letterId: string, filename?: string) {
  const blob = await apiBlob(`/v1/letters/generated/${letterId}/pdf`)
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename ?? `letter-${letterId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
