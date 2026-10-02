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
  employeeName?: string
  employeeCode?: string
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
  // Redesign (BW-71, BW-74, BW-76): additive, absent on older servers.
  /** When the employee signed it. */
  signedAt?: string | null
  /** The issue date HR chose (yyyy-MM-dd); null when the letter is dated the day it was generated. */
  issueDate?: string | null
  departmentName?: string | null
  templateName?: string | null
  generatedByName?: string | null
  /** HR asked for a signature; null/absent while signatures aren't switched on. */
  signatureRequested?: boolean | null
  signatureRequestedAt?: string | null
  /** The name the employee typed to sign. */
  signedName?: string | null
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
  /** yyyy-MM-dd; the today fields print it and lists show it as Issued (BW-74). */
  issueDate?: string
  /** Ask the employee to sign it once it's sent (BW-76). */
  requestSignature?: boolean
}

export interface SendLetterRequest {
  toEmail?: string
  ccEmail?: string
  /** Ask the employee to sign it (BW-76). */
  requestSignature?: boolean
}

export interface VoidLetterRequest {
  reason: string
}

// ── Template hooks ────────────────────────────────────────────────────────────

export function useLetterTemplates(page = 0, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'templates', page],
    queryFn: () =>
      apiJson<PageResponse<LetterTemplateDto>>(`/v1/letters/templates?page=${page}&size=20`),
    staleTime: 60_000,
    enabled: opts?.enabled ?? true,
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

export function useGeneratedLetters(page = 0, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'generated', page],
    queryFn: () =>
      apiJson<PageResponse<GeneratedLetterDto>>(`/v1/letters/generated?page=${page}&size=20`),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
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

export function useDeleteGeneratedLetter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/letters/generated/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'generated'] }),
  })
}

// ── Employee self-service ─────────────────────────────────────────────────────

export function useMyLetters(page = 0, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'my', page],
    queryFn: () =>
      apiJson<PageResponse<GeneratedLetterDto>>(`/v1/letters/my?page=${page}&size=20`),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
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

// ── Preview before saving (client request, 2 Oct) ─────────────────────────────

/** What to preview: a draft as it's being edited, or a saved template; for an employee; on a date. */
export interface LetterPreviewRequest {
  templateId?: string
  companyId?: string
  subject?: string
  bodyHtml?: string
  /** Left out: the viewer's own record, else the catalogue's example values. */
  employeeId?: string
  issueDate?: string
}

export interface LetterPage { size: string; widthMm: number; heightMm: number; marginMm: number }

/** The letter as it would come out: the letterhead and the body, merge fields filled, on its page. */
export interface LetterPreview {
  subject: string
  html: string
  companyId?: string | null
  companyName?: string | null
  employeeId?: string | null
  employeeName?: string | null
  /** True when the catalogue's example values were used (no employee to show). */
  sample: boolean
  /** Merge fields with no value (shown in red in the letter). */
  unresolved: string[]
  issueDate?: string | null
  page: LetterPage
}

/**
 * The live preview (POST /v1/letters/templates/preview). Keyed by the request,
 * so a change fetches a new one; the last one stays on screen meanwhile.
 * Pass `enabled: false` until there is something to preview.
 */
export function useLetterPreview(req: LetterPreviewRequest, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hrms', 'letters', 'preview', req],
    queryFn: () => apiJson<LetterPreview>('/v1/letters/templates/preview', { method: 'POST', body: JSON.stringify(req) }),
    enabled: opts?.enabled ?? true,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: false,
  })
}

/** The same preview as the PDF it would become, opened in a new tab (or saved where tabs are blocked). */
export async function openPreviewPdf(req: LetterPreviewRequest) {
  const win = window.open('', '_blank')
  try {
    const blob = await apiBlob('/v1/letters/templates/preview/pdf', {
      method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'application/json' },
    })
    const url = URL.createObjectURL(blob)
    if (win) win.location.href = url
    else { const a = document.createElement('a'); a.href = url; a.download = 'letter-preview.pdf'; a.click() }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    win?.close()
    throw e
  }
}

// ── My letters: read and sign (BW-75, BW-76) ──────────────────────────────────

export interface ReadableLetter {
  id: string
  subject: string
  html: string
  status: LetterStatus
  signatureRequested?: boolean | null
  signedAt?: string | null
  signedName?: string | null
  page: LetterPage
}

/** One of my letters to read (opening it marks it viewed). */
export function useReadMyLetter(id: string | undefined) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['hrms', 'letters', 'my', 'read', id],
    queryFn: async () => {
      const letter = await apiJson<ReadableLetter>(`/v1/letters/my/${id}/html`)
      qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'my'], exact: false, refetchType: 'none' })
      return letter
    },
    enabled: !!id,
    staleTime: 60_000,
  })
}

/** Sign my letter: click to accept with my typed name. */
export function useSignLetter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, typedName }: { id: string; typedName: string }) =>
      apiJson<GeneratedLetterDto>(`/v1/letters/my/${id}/sign`, { method: 'POST', body: JSON.stringify({ typedName, accept: true }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'my'] })
      qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'generated'] })
    },
  })
}

/** Download a letter's PDF and refresh My letters (the owner downloading it marks it viewed). */
export function useDownloadLetter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, filename }: { id: string; filename?: string }) => downloadLetterPdf(id, filename),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'letters', 'my'] }),
  })
}
