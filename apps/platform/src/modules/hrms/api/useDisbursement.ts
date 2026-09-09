import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson, apiBlob } from '@/core/api/client'

/**
 * Bank profiles + payroll disbursement batches.
 *
 * Both backend controllers (BankProfileController, DisbursementBatchController)
 * shipped in Wave 2 and had ZERO frontend callers until 2026-09-09 — the Bank
 * Disbursement page was a read-only view over payroll-run rows with a
 * browser-generated CSV, so no batch was ever recorded, no bank file was ever
 * fetched from the server, and no payroll run ever reached PAID from that
 * screen.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Mirrors BankProfileService.ALLOWED_FORMATS. */
export type BankFormat = 'GENERIC_CSV' | 'HDFC_FIXED' | 'ICICI_CIB' | 'SBI_CORP'

export const BANK_FORMATS: { value: BankFormat; label: string }[] = [
  { value: 'GENERIC_CSV', label: 'Generic CSV' },
  { value: 'HDFC_FIXED', label: 'HDFC (fixed width)' },
  { value: 'ICICI_CIB', label: 'ICICI CIB' },
  { value: 'SBI_CORP', label: 'SBI Corporate' },
]

/** Same rule the server validates with — reject early instead of on submit. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/

export interface BankProfile {
  id: string
  companyId: string
  profileName: string
  bankFormat: BankFormat
  corporateId?: string | null
  debitAccountNo: string
  ifsc: string
  isDefault: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type BatchStatus = 'DRAFT' | 'POSTED' | 'PAID' | 'CANCELLED'

export interface DisbursementBatch {
  id: string
  companyId: string
  runId: string
  bankProfileId: string
  batchReference: string
  totalAmount: number
  beneficiaryCount: number
  status: BatchStatus
  fileGeneratedAt?: string | null
  postedAt?: string | null
  paidAt?: string | null
  paymentReference?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export interface BatchLine {
  id: string
  employeeId: string
  beneficiaryName: string
  accountNoMasked: string
  accountNoLast4: string
  ifsc: string
  amount: number
  status: string
  failureReason?: string | null
}

export interface BatchDetail {
  batch: DisbursementBatch
  lines: BatchLine[]
}

const PROFILE_KEY = ['hrms', 'payroll', 'bank-profiles'] as const
const BATCH_KEY = ['hrms', 'payroll', 'disbursement-batches'] as const

// ── Bank profiles ────────────────────────────────────────────────────────────

export function useBankProfiles(companyId?: string, opts?: { enabled?: boolean }) {
  const qs = new URLSearchParams()
  if (companyId) qs.set('companyId', companyId)
  const suffix = qs.toString() ? `?${qs}` : ''
  return useQuery({
    queryKey: [...PROFILE_KEY, 'list', companyId ?? 'all'],
    queryFn: () => apiJson<BankProfile[]>(`/v1/payroll/bank-profiles${suffix}`),
    enabled: opts?.enabled ?? true,
    staleTime: 60_000,
  })
}

export interface CreateBankProfilePayload {
  companyId: string
  profileName: string
  bankFormat: BankFormat
  corporateId?: string
  debitAccountNo: string
  ifsc: string
  isDefault?: boolean
}

export function useCreateBankProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBankProfilePayload) =>
      apiJson<BankProfile>('/v1/payroll/bank-profiles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
  })
}

export function useUpdateBankProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<CreateBankProfilePayload> & { isActive?: boolean }) =>
      apiJson<BankProfile>(`/v1/payroll/bank-profiles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
  })
}

export function useDeleteBankProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<void>(`/v1/payroll/bank-profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
  })
}

// ── Disbursement batches ─────────────────────────────────────────────────────

export function useDisbursementBatches(
  filters: { runId?: string; companyId?: string; status?: BatchStatus } = {},
  opts?: { enabled?: boolean },
) {
  const qs = new URLSearchParams()
  if (filters.runId) qs.set('runId', filters.runId)
  if (filters.companyId) qs.set('companyId', filters.companyId)
  if (filters.status) qs.set('status', filters.status)
  const suffix = qs.toString() ? `?${qs}` : ''
  return useQuery({
    queryKey: [...BATCH_KEY, 'list', filters],
    queryFn: () => apiJson<DisbursementBatch[]>(`/v1/payroll/disbursement/batches${suffix}`),
    enabled: opts?.enabled ?? true,
    staleTime: 15_000,
  })
}

export function useDisbursementBatch(id: string | undefined) {
  return useQuery({
    queryKey: [...BATCH_KEY, 'detail', id],
    queryFn: () => apiJson<BatchDetail>(`/v1/payroll/disbursement/batches/${id}`),
    enabled: !!id,
  })
}

/** Build a DRAFT batch from a LOCKED payroll run. Idempotent per (run, profile). */
export function useBuildBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { runId: string; bankProfileId: string }) =>
      apiJson<BatchDetail>('/v1/payroll/disbursement/batches', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: BATCH_KEY }),
  })
}

/** Mark the batch PAID with the bank's UTR. Also flips the payroll run to PAID. */
export function useMarkBatchPaid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, paymentReference, notes }: { id: string; paymentReference: string; notes?: string }) =>
      apiJson<DisbursementBatch>(`/v1/payroll/disbursement/batches/${id}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({ paymentReference, notes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BATCH_KEY })
      // The run's own status changes to PAID server-side — refresh the run lists
      // so the page's status pill and the Payroll Runs table both catch up.
      qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'runs'] })
    },
  })
}

export function useCancelBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<DisbursementBatch>(`/v1/payroll/disbursement/batches/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: BATCH_KEY }),
  })
}

/**
 * Download the NEFT/RTGS file for a batch.
 *
 * Server-side this ALSO flips DRAFT → POSTED (the endpoint is deliberately
 * side-effecting so a batch cannot be downloaded without being recorded as
 * posted), so callers must invalidate the batch queries afterwards — that is
 * what useDownloadBatchFile does.
 */
export async function downloadBatchFile(batchId: string, filename?: string): Promise<void> {
  const blob = await apiBlob(`/v1/payroll/disbursement/batches/${batchId}/file`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `payroll-batch-${batchId}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function useDownloadBatchFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, filename }: { id: string; filename?: string }) => downloadBatchFile(id, filename),
    onSuccess: () => qc.invalidateQueries({ queryKey: BATCH_KEY }),
  })
}
