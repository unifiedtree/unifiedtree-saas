import React, { useEffect, useMemo, useState } from 'react'
import { DisbursementHistory } from './DisbursementHistory'
import { Link } from 'react-router-dom'
import { Banknote, Users, Wallet, ListChecks, Landmark, Download, Plus, Pencil, Power, Trash2, CheckCircle2, XCircle, Building2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from '../api/useOrg'
import {
  useRuns, useRunEmployees, MONTHS, inr, type RunStatus,
} from '../api/usePayrollRuns'
import {
  useBankProfiles, useCreateBankProfile, useUpdateBankProfile, useDeleteBankProfile,
  useDisbursementBatches, useDisbursementBatch, useBuildBatch, useDownloadBatchFile,
  useMarkBatchPaid, useCancelBatch,
  BANK_FORMATS, IFSC_PATTERN,
  type BankFormat, type BatchStatus, type BankProfile,
} from '../api/useDisbursement'

// Map payroll run status → client status-pill tone.
const STATUS_TONE: Record<RunStatus, PillTone> = {
  DRAFT: 'gray',
  PROCESSING: 'info',
  LOCKED: 'purple',
  PAID: 'ok',
  CANCELLED: 'red',
}

const BATCH_TONE: Record<BatchStatus, PillTone> = {
  DRAFT: 'gray',
  POSTED: 'info',
  PAID: 'ok',
  CANCELLED: 'red',
}

// Fixed net-pay bands (config, not data) used to bucket live rows for the chart.
const BANDS: { label: string; min: number; max: number }[] = [
  { label: '< 25k', min: 0, max: 25_000 },
  { label: '25–50k', min: 25_000, max: 50_000 },
  { label: '50–75k', min: 50_000, max: 75_000 },
  { label: '75k–1L', min: 75_000, max: 100_000 },
  { label: '> 1L', min: 100_000, max: Infinity },
]
const BAND_COLORS = ['#2563EB', '#22C55E', '#F59E0B', '#8B5CF6', '#06B6D4']

const fmtPeriod = (start?: string, end?: string) => {
  if (!start || !end) return '—'
  try {
    return `${format(parseISO(start), 'd MMM')} – ${format(parseISO(end), 'd MMM yyyy')}`
  } catch {
    return `${start} – ${end}`
  }
}

export const BankDisbursement: React.FC = () => {
  const { toast } = useToast()
  const canExport = usePermission('payroll.runs.read')
  // Backend permissions on DisbursementBatchController / BankProfileController.
  // Granted to FINANCE_LEAD/OWNER/SUPER_ADMIN by default (V093/V094).
  const canReadBatches = usePermission('hrms.disbursement.read')
  const canBuildBatch  = usePermission('hrms.disbursement.build')
  const canPostBatch   = usePermission('hrms.disbursement.post')
  const canReadProfile = usePermission('hrms.bank_profile.read')
  const canManageProfile = usePermission('hrms.bank_profile.manage')

  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')

  const { data: runs = [], isLoading: runsLoading } = useRuns(companyId ? { companyId } : {})
  const [runId, setRunId] = useState('')
  const [query, setQuery] = useState('')

  // Keep the selected run valid as the run list changes (company switch / load).
  useEffect(() => {
    if (runs.length === 0) {
      if (runId) setRunId('')
      return
    }
    if (!runs.some((r) => r.id === runId)) {
      // Prefer a finalized run (PAID/LOCKED) for a disbursement advice, else newest.
      const preferred = runs.find((r) => r.status === 'PAID' || r.status === 'LOCKED') ?? runs[0]
      setRunId(preferred.id)
    }
  }, [runs, runId])

  const selectedRun = useMemo(() => runs.find((r) => r.id === runId) ?? null, [runs, runId])

  const { data: rows = [], isLoading: rowsLoading, isError: rowsError, refetch: refetchRows } = useRunEmployees(runId)

  const payrollTotals = useMemo(() => {
    const total = rows.reduce((s, r) => s + (r.netPay ?? 0), 0)
    const count = rows.length
    const avg = count > 0 ? total / count : 0
    return { total, count, avg }
  }, [rows])

  const bandData = useMemo(
    () =>
      BANDS.map((b) => ({
        label: b.label,
        count: rows.filter((r) => (r.netPay ?? 0) >= b.min && (r.netPay ?? 0) < b.max).length,
      })),
    [rows],
  )

  const hasRun = !!selectedRun

  // ── Bank profiles + batches for the selected (company, run) ───────────────
  const effectiveCompanyId = companyId || selectedRun?.companyId || ''
  const { data: profiles = [] } = useBankProfiles(
    effectiveCompanyId || undefined,
    { enabled: canReadProfile && !!effectiveCompanyId },
  )
  const { data: batches = [], isLoading: batchesLoading, isError: batchesError, refetch: refetchBatches } = useDisbursementBatches(
    runId ? { runId } : {},
    { enabled: canReadBatches && !!runId },
  )
  // The pre-existing (DRAFT/POSTED/PAID) batch for this run, if any — the
  // server enforces one live batch per run; we display the most
  // recent that is not CANCELLED so operators see the state their button
  // clicks will act on.
  const activeBatch = useMemo(
    () => batches.find((b) => b.status !== 'CANCELLED') ?? null,
    [batches],
  )
  const { data: batchDetail, isLoading: detailLoading, isError: detailError, refetch: refetchDetail } = useDisbursementBatch(activeBatch?.id)
  const hasExcludedEmployees = !!batchDetail?.lines.some(line => line.status !== 'READY')
  const totals = activeBatch ? { total: activeBatch.totalAmount, count: activeBatch.beneficiaryCount, avg: activeBatch.beneficiaryCount ? activeBatch.totalAmount / activeBatch.beneficiaryCount : 0 } : payrollTotals
  const tableLoading = activeBatch ? detailLoading : rowsLoading
  const tableError = activeBatch ? detailError : rowsError
  const displayRows = useMemo(() => activeBatch ? (batchDetail?.lines ?? []).map(line => {
    const payroll = rows.find(row => row.employeeId === line.employeeId)
    return { employeeId: line.employeeId, employeeName: line.beneficiaryName, employeeCode: payroll?.employeeCode ?? '', paidDays: payroll?.paidDays, lopDays: payroll?.lopDays, netPay: line.amount, bankLast4: line.accountNoLast4, status: line.status, failureReason: line.failureReason }
  }) : rows.map(row => ({ ...row, bankLast4: '', status: '', failureReason: null })), [activeBatch, batchDetail, rows])
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()
    return displayRows.filter(row => !search || row.employeeName.toLowerCase().includes(search) || row.employeeCode.toLowerCase().includes(search))
  }, [displayRows, query])
  const showEmpty = hasRun && !tableLoading && displayRows.length === 0

  // ── Batch mutations ────────────────────────────────────────────────────────
  const buildBatch = useBuildBatch()
  const downloadBatch = useDownloadBatchFile()
  const markPaid = useMarkBatchPaid()
  const cancelBatch = useCancelBatch()
  const createProfile = useCreateBankProfile()
  const updateProfile = useUpdateBankProfile()
  const deleteProfile = useDeleteBankProfile()

  const [showProfileForm, setShowProfileForm] = useState(false)
  // Null = the panel is in "add" mode; an id = editing that row. The same form
  // markup serves both, so a field added to one can never go missing from the
  // other. Added 2026-09-09: the panel shipped with Add + Delete only, so
  // correcting a typo'd IFSC or account number meant deleting and recreating a
  // profile that live disbursement batches hold a foreign key to (and which the
  // server refuses to delete once any batch references it).
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [profileName, setProfileName]         = useState('')
  const [bankFormat, setBankFormat]           = useState<BankFormat>('GENERIC_CSV')
  const [corporateId, setCorporateId]         = useState('')
  const [debitAccountNo, setDebitAccountNo]   = useState('')
  const [ifsc, setIfsc]                       = useState('')
  const [profileIsDefault, setProfileIsDefault] = useState(false)

  const [selectedProfileId, setSelectedProfileId] = useState('')
  useEffect(() => {
    const usable = profiles.filter(profile => profile.isActive && profile.bankFormat === 'GENERIC_CSV')
    if (!usable.some((p) => p.id === selectedProfileId)) {
      setSelectedProfileId(usable.find((p) => p.isDefault)?.id ?? usable[0]?.id ?? '')
    }
  }, [profiles, selectedProfileId])

  const resetProfileForm = () => {
    setProfileName(''); setCorporateId(''); setDebitAccountNo(''); setIfsc('')
    setProfileIsDefault(false); setBankFormat('GENERIC_CSV')
  }

  const closeProfileForm = () => {
    setShowProfileForm(false)
    setEditingProfileId(null)
    resetProfileForm()
  }

  /** Header button: opens a blank form, or drops an in-progress edit back to
   *  "add" mode so a half-finished edit's id can never leak into a create. */
  const toggleAddProfileForm = () => {
    if (showProfileForm && !editingProfileId) { closeProfileForm(); return }
    resetProfileForm()
    setEditingProfileId(null)
    setShowProfileForm(true)
  }

  const openEditProfileForm = (p: BankProfile) => {
    setProfileName(p.profileName)
    setBankFormat(p.bankFormat)
    setCorporateId(p.corporateId ?? '')
    setDebitAccountNo(p.debitAccountNo)
    setIfsc(p.ifsc)
    setProfileIsDefault(p.isDefault)
    setEditingProfileId(p.id)
    setShowProfileForm(true)
  }

  const onSubmitProfile = async () => {
    if (bankFormat !== 'GENERIC_CSV') { toast('Choose Generic CSV; other bank formats are not supported.', 'error'); return }
    // Shared validation: the create and update routes run the same server-side
    // checks (BankProfileService.validateIfsc / validateFormat), so validating
    // once here keeps the two paths from drifting apart.
    if (!profileName.trim()) { toast('Profile name is required', 'error'); return }
    if (!debitAccountNo.trim()) { toast('Debit account number is required', 'error'); return }
    if (!IFSC_PATTERN.test(ifsc.trim().toUpperCase())) {
      // Fail early with the same message shape the server would return, so the
      // operator doesn't wait a round-trip to learn the code is malformed.
      toast('IFSC must look like ABCD0XXXXXX (11 chars, 5th is zero)', 'error'); return
    }

    if (editingProfileId) {
      try {
        await updateProfile.mutateAsync({
          id: editingProfileId,
          profileName: profileName.trim(),
          bankFormat,
          // '' rather than undefined on purpose: the server null-guards every
          // field, so OMITTING corporateId would leave the old value in place
          // and an operator clearing the box would silently keep a stale
          // corporate id on the file the bank receives.
          corporateId: corporateId.trim(),
          debitAccountNo: debitAccountNo.trim(),
          ifsc: ifsc.trim().toUpperCase(),
          isDefault: profileIsDefault,
          // isActive is deliberately not sent — activation is its own row
          // control, so saving an edit never silently reactivates a profile
          // somebody deactivated.
        })
        toast('Bank profile updated', 'success')
        closeProfileForm()
      } catch (e) {
        toast((e as Error)?.message ?? 'Failed to update bank profile', 'error')
      }
      return
    }

    if (!effectiveCompanyId) { toast('Pick a company first', 'error'); return }
    try {
      await createProfile.mutateAsync({
        companyId: effectiveCompanyId,
        profileName: profileName.trim(),
        bankFormat,
        corporateId: corporateId.trim() || undefined,
        debitAccountNo: debitAccountNo.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        isDefault: profileIsDefault,
      })
      toast('Bank profile added', 'success')
      closeProfileForm()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to create bank profile', 'error')
    }
  }

  /**
   * Deactivating is the supported alternative to deleting: the server refuses
   * to delete a profile any disbursement batch references (BANK_PROFILE_IN_USE),
   * and the build-batch picker below already lists active profiles only.
   */
  const onToggleProfileActive = async (p: BankProfile) => {
    if (p.isActive && !window.confirm(`Deactivate bank profile "${p.profileName}"? Existing batches keep it, but it can no longer be picked when building a new batch.`)) return
    try {
      await updateProfile.mutateAsync({ id: p.id, isActive: !p.isActive })
      toast(p.isActive ? `"${p.profileName}" deactivated` : `"${p.profileName}" activated`, 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to update bank profile', 'error')
    }
  }

  const onDeleteProfile = async (id: string, name: string) => {
    if (!window.confirm(`Delete bank profile "${name}"? Existing batches keep their reference; new batches can no longer use it.`)) return
    try {
      await deleteProfile.mutateAsync(id)
      // Close the editor if it was pointed at the row that just vanished —
      // otherwise Save would PUT to a deleted id and 404.
      if (editingProfileId === id) closeProfileForm()
      toast('Bank profile deleted', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to delete bank profile', 'error')
    }
  }

  const onBuild = async () => {
    if (!runId) { toast('Pick a payroll run first', 'error'); return }
    if (!selectedProfileId) { toast('Pick a bank profile', 'error'); return }
    if (selectedRun?.status !== 'LOCKED') {
      // The server accepts LOCKED only; catch it here so the user sees a
      // sensible message rather than a raw BusinessRuleException.
      toast('Only a LOCKED payroll run can be disbursed. Lock the run first.', 'error'); return
    }
    try {
      await buildBatch.mutateAsync({ runId, bankProfileId: selectedProfileId })
      toast('Disbursement batch built', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to build batch', 'error')
    }
  }

  const onDownloadBatchFile = async () => {
    if (!activeBatch) return
    const filename = selectedRun
      ? `bank-file-${MONTHS[selectedRun.periodMonth - 1]}-${selectedRun.periodYear}.csv`
      : undefined
    try {
      await downloadBatch.mutateAsync({ id: activeBatch.id, filename })
      // Note: server flips DRAFT->POSTED as a side-effect, which is why the
      // mutation invalidates the batches query — the pill will refresh.
      toast('Bank file downloaded — batch is now POSTED', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to download bank file', 'error')
    }
  }

  const onMarkPaid = async () => {
    if (!activeBatch) return
    if (activeBatch.status !== 'POSTED') {
      toast('Download the bank file first — mark-paid needs a POSTED batch.', 'error'); return
    }
    const utr = window.prompt('Bank UTR / payment reference (required):')
    // Cancel returns null; empty string is the same as no reference and would
    // fail the server-side @NotBlank, so treat both as abort.
    if (utr === null) return
    if (!utr.trim()) { toast('UTR is required to mark paid', 'error'); return }
    try {
      await markPaid.mutateAsync({ id: activeBatch.id, paymentReference: utr.trim() })
      toast('Marked paid — payroll run is now PAID', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to mark paid', 'error')
    }
  }

  const onCancelBatch = async () => {
    if (!activeBatch) return
    if (activeBatch.status === 'PAID' || activeBatch.status === 'CANCELLED') {
      toast(`Cannot cancel a ${activeBatch.status} batch`, 'error'); return
    }
    if (!window.confirm(`Cancel this disbursement batch (${activeBatch.batchReference})? The payroll run stays LOCKED and you can build a fresh batch afterwards.`)) return
    try {
      await cancelBatch.mutateAsync(activeBatch.id)
      toast('Batch cancelled', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to cancel batch', 'error')
    }
  }

  const handleExport = () => {
    if (!selectedRun || rows.length === 0) return
    const header = ['Employee Code', 'Employee Name', 'Paid Days', 'LOP Days', 'Net Pay (INR)']
    const lines = rows.map((r) =>
      [r.employeeCode, r.employeeName, r.paidDays, r.lopDays, Math.round(r.netPay ?? 0)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    )
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bank-advice-${MONTHS[selectedRun.periodMonth - 1]}-${selectedRun.periodYear}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast('Bank advice exported', 'success')
  }

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Payroll"
        title="Bank Disbursement"
        subtitle="Review payroll amounts, bank readiness and recorded payments."
        actions={
          canExport && hasRun && rows.length > 0 ? (
            <HrButton variant="ghost" onClick={handleExport}>
              <Download size={15} /> Export advice
            </HrButton>
          ) : undefined
        }
      />

      {/* ── Selectors ─────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Company</label>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="min-w-[200px] rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Payroll run</label>
          <select
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            disabled={runsLoading || runs.length === 0}
            className="min-w-[260px] rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20 disabled:opacity-50"
          >
            {runsLoading && <option value="">Loading runs…</option>}
            {!runsLoading && runs.length === 0 && <option value="">No payroll runs</option>}
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {MONTHS[r.periodMonth - 1]} {r.periodYear} · {r.companyName} · {r.status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!hasRun && !runsLoading && (
        <div className="rounded-xl border border-dashed border-border-default bg-white py-16 text-center">
          <Landmark size={28} className="mx-auto text-text-tertiary" />
          <p className="mt-3 text-sm font-semibold text-text-secondary">No payroll run selected</p>
          <p className="mt-1 text-xs text-text-tertiary">
            {runs.length === 0
              ? 'Create and process a payroll run to generate a bank advice.'
              : 'Choose a run above to see its disbursement advice.'}
          </p>
        </div>
      )}

      {/* ── Bank profiles (setup step; hidden until a company is picked) ── */}
      {canReadProfile && effectiveCompanyId && (
        <div className="ut-card mb-5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">
                <Building2 size={15} className="mr-1.5 inline-block -translate-y-px text-text-secondary" />
                Bank profiles
              </p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Debit accounts used to generate the bank's NEFT/RTGS file. At least one profile is required to build a disbursement batch.
              </p>
            </div>
            {canManageProfile && (
              <HrButton
                variant={showProfileForm && !editingProfileId ? 'ghost' : 'primary'}
                size="sm"
                onClick={toggleAddProfileForm}
              >
                <Plus size={14} /> {showProfileForm && !editingProfileId ? 'Close' : 'Add profile'}
              </HrButton>
            )}
          </div>

          {showProfileForm && canManageProfile && (
            <div className="mb-4 rounded-xl border border-border-default bg-white p-4">
              {/* Same markup for both modes — only the heading and the submit
                  handler differ, so a field can never exist on one and not the
                  other. */}
              <p className="mb-3 text-[13px] font-semibold text-text-primary">
                {editingProfileId ? 'Edit bank profile' : 'New bank profile'}
              </p>
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Profile name *</label>
                  <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. HDFC Payroll Salary A/C" className="ut-input" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Bank format *</label>
                  <select value={bankFormat} onChange={(e) => setBankFormat(e.target.value as BankFormat)} className="ut-select">
                    {bankFormat !== 'GENERIC_CSV' && <option value={bankFormat} disabled>{bankFormat} (unsupported)</option>}
                    <option value="GENERIC_CSV">Generic CSV</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Debit account no *</label>
                  <input value={debitAccountNo} onChange={(e) => setDebitAccountNo(e.target.value)} className="ut-input" maxLength={60} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">IFSC *</label>
                  <input
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    className="ut-input font-mono uppercase"
                    maxLength={11}
                    placeholder="HDFC0001234"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Corporate ID</label>
                  <input value={corporateId} onChange={(e) => setCorporateId(e.target.value)} className="ut-input" maxLength={60} placeholder="Optional (bank portal login id)" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" checked={profileIsDefault} onChange={(e) => setProfileIsDefault(e.target.checked)} className="h-4 w-4 rounded border-border-default text-[#059669] focus:ring-[#059669]" />
                    Make default for this company
                  </label>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t border-border-default pt-3">
                {editingProfileId && (
                  <HrButton size="sm" variant="ghost" onClick={closeProfileForm}>Cancel</HrButton>
                )}
                <HrButton size="sm" onClick={onSubmitProfile} disabled={createProfile.isPending || updateProfile.isPending}>
                  {createProfile.isPending || updateProfile.isPending ? 'Saving…' : (editingProfileId ? 'Save changes' : 'Save profile')}
                </HrButton>
              </div>
            </div>
          )}

          {profiles.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-xs text-text-tertiary">
              No bank profiles for this company yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border-default">
              <table className="hr-table hr-table--compact">
                <thead>
                  <tr>
                    <th>Profile</th>
                    <th className="hidden sm:table-cell">Format</th>
                    <th>Account · IFSC</th>
                    <th className="hidden md:table-cell">Default</th>
                    {canManageProfile && <th className="text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium text-text-primary">
                        {p.profileName}
                        {!p.isActive && <span className="ml-2 text-xs text-text-tertiary">(inactive)</span>}
                      </td>
                      <td className="hidden sm:table-cell text-text-secondary">
                        {BANK_FORMATS.find((f) => f.value === p.bankFormat)?.label ?? p.bankFormat}
                      </td>
                      <td className="font-mono text-xs text-text-secondary">
                        …{p.debitAccountNo.slice(-4)} · {p.ifsc}
                      </td>
                      <td className="hidden md:table-cell">
                        {p.isDefault && <HrStatusPill tone="ok">Default</HrStatusPill>}
                      </td>
                      {canManageProfile && (
                        <td>
                          {/* All three controls hit BankProfileController and are
                              gated on hrms.bank_profile.manage: PUT /{id} for
                              edit and for the active toggle, DELETE /{id} for
                              remove. */}
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditProfileForm(p)}
                              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-emerald-50 hover:text-[#047857]"
                              aria-label={`Edit ${p.profileName}`}
                              disabled={updateProfile.isPending}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => onToggleProfileActive(p)}
                              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-amber-50 hover:text-amber-700"
                              aria-label={`${p.isActive ? 'Deactivate' : 'Activate'} ${p.profileName}`}
                              title={p.isActive ? 'Deactivate' : 'Activate'}
                              disabled={updateProfile.isPending}
                            >
                              <Power size={14} />
                            </button>
                            <button
                              onClick={() => onDeleteProfile(p.id, p.profileName)}
                              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-red-50 hover:text-red-600"
                              aria-label={`Delete ${p.profileName}`}
                              disabled={deleteProfile.isPending}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {hasRun && (
        <>
          {/* ── Disbursement batch controls (Build / Post / Mark paid) ── */}
          {(canReadBatches || canBuildBatch || canPostBatch) && (
            <div className="ut-card mb-5 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    <Banknote size={15} className="mr-1.5 inline-block -translate-y-px text-text-secondary" />
                    Disbursement batch
                  </p>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    {batchesError ? 'Batch state could not be loaded.' : batchesLoading ? 'Loading batch state...' : activeBatch
                      ? <>Batch <span className="font-mono">{activeBatch.batchReference}</span> · {activeBatch.beneficiaryCount} beneficiaries · {inr(activeBatch.totalAmount)}</>
                      : selectedRun?.status === 'LOCKED'
                        ? 'No batch built yet — pick a bank profile and click Build.'
                        : `Payroll run is ${selectedRun?.status}. Only LOCKED runs can be disbursed.`}
                  </p>
                </div>
                {activeBatch && <HrStatusPill tone={BATCH_TONE[activeBatch.status]}>{activeBatch.status}</HrStatusPill>}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                {batchesError && <div role="alert" className="text-sm"><p>Unable to load existing bank batches.</p><HrButton variant="ghost" onClick={() => refetchBatches()}>Try again</HrButton></div>}
                {batchesLoading && <p role="status" className="text-sm text-text-secondary">Loading bank batches...</p>}
                {!activeBatch && !batchesLoading && !batchesError && canBuildBatch && (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Bank profile</label>
                      <select
                        value={selectedProfileId}
                        onChange={(e) => setSelectedProfileId(e.target.value)}
                        disabled={!profiles.some(p => p.isActive && p.bankFormat === 'GENERIC_CSV')}
                        className="min-w-[220px] rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20 disabled:opacity-50"
                      >
                        {!profiles.some(p => p.isActive && p.bankFormat === 'GENERIC_CSV') && <option value="">Add an active Generic CSV profile</option>}
                        {profiles.filter((p) => p.isActive && p.bankFormat === 'GENERIC_CSV').map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.profileName} · …{p.debitAccountNo.slice(-4)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <HrButton
                      onClick={onBuild}
                      disabled={buildBatch.isPending || !selectedProfileId || selectedRun?.status !== 'LOCKED'}
                    >
                      <Plus size={15} /> {buildBatch.isPending ? 'Building…' : 'Build batch'}
                    </HrButton>
                  </>
                )}

                {activeBatch && canBuildBatch && (activeBatch.status === 'DRAFT' || activeBatch.status === 'POSTED') && (
                  <HrButton onClick={onDownloadBatchFile} disabled={downloadBatch.isPending || activeBatch.beneficiaryCount === 0 || hasExcludedEmployees || detailLoading || detailError}>
                    <Download size={15} /> {downloadBatch.isPending ? 'Downloading…' : (activeBatch.status === 'DRAFT' ? 'Download bank file (posts batch)' : 'Re-download bank file')}
                  </HrButton>
                )}
                {activeBatch?.status === 'DRAFT' && canBuildBatch && <HrButton variant="ghost" disabled={buildBatch.isPending} onClick={async () => {
                  try { await buildBatch.mutateAsync({ runId, bankProfileId: activeBatch.bankProfileId }); toast('Batch refreshed from current employee bank details', 'success') }
                  catch (error) { toast((error as Error).message, 'error') }
                }}>Rebuild batch</HrButton>}

                {activeBatch && canPostBatch && activeBatch.status === 'POSTED' && (
                  <HrButton variant="primary" onClick={onMarkPaid} disabled={markPaid.isPending || hasExcludedEmployees || detailLoading || detailError}>
                    <CheckCircle2 size={15} /> {markPaid.isPending ? 'Marking…' : 'Mark paid (UTR)'}
                  </HrButton>
                )}

                {activeBatch && canPostBatch && (activeBatch.status === 'DRAFT' || activeBatch.status === 'POSTED') && (
                  <HrButton variant="ghost" onClick={onCancelBatch} disabled={cancelBatch.isPending}>
                    <XCircle size={15} /> Cancel batch
                  </HrButton>
                )}
              </div>

              {hasExcludedEmployees && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Some employees are excluded. Correct their bank details and rebuild the draft before downloading a bank file or recording payment. For an older posted batch, cancel it and build a corrected batch first.</p>}

              {activeBatch?.paymentReference && (
                <p className="mt-3 border-t border-border-default pt-3 text-xs text-text-secondary">
                  Paid on {activeBatch.paidAt ? format(parseISO(activeBatch.paidAt), 'd MMM yyyy, h:mm a') : '—'} · UTR <span className="font-mono">{activeBatch.paymentReference}</span>
                </p>
              )}
            </div>
          )}

          {/* ── KPI cards ──────────────────────────────────────────── */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <HrStatCard
              icon={<Banknote size={18} />}
              color="green"
              value={inr(totals.total)}
              label={activeBatch ? (activeBatch.status === 'PAID' ? 'Payment recorded' : 'Batch total') : 'Payroll net total'}
              sub={selectedRun ? `${MONTHS[selectedRun.periodMonth - 1]} ${selectedRun.periodYear}` : undefined}
              loading={rowsLoading}
            />
            <HrStatCard
              icon={<Users size={18} />}
              color="blue"
              value={totals.count}
              label={activeBatch ? 'Bank beneficiaries' : 'Employees in payroll'}
              sub={activeBatch ? (activeBatch.status === 'PAID' ? 'payment recorded' : 'ready for payment') : 'payment not yet prepared'}
              loading={rowsLoading}
            />
            <HrStatCard
              icon={<Wallet size={18} />}
              color="teal"
              value={inr(totals.avg)}
              label={activeBatch ? 'Average batch amount' : 'Average net pay'}
              loading={rowsLoading}
            />
            <HrStatCard
              icon={<ListChecks size={18} />}
              color="purple"
              value={selectedRun ? <HrStatusPill tone={STATUS_TONE[selectedRun.status]}>{selectedRun.status}</HrStatusPill> : '—'}
              label="Run Status"
              sub={selectedRun ? fmtPeriod(selectedRun.periodStart, selectedRun.periodEnd) : undefined}
              loading={rowsLoading}
            />
          </div>

          {/* ── Net-pay distribution chart ─────────────────────────── */}
          {!rowsLoading && rows.length > 0 && (
            <div className="ut-card mb-5 p-5">
              <p className="mb-4 text-sm font-semibold text-text-primary">Net-pay distribution</p>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bandData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(5, 150, 105,0.06)' }}
                      formatter={(v: number) => [`${v} employee${v === 1 ? '' : 's'}`, 'Count']}
                      contentStyle={{ borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 12 }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={64}>
                      {bandData.map((_, i) => (
                        <Cell key={i} fill={BAND_COLORS[i % BAND_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Disbursement table ─────────────────────────────────── */}
          <TableCard
            search={{ value: query, onChange: setQuery, placeholder: 'Search employee or code…' }}
            footer={
              !tableLoading && !tableError && displayRows.length > 0 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">
                    {filtered.length} of {displayRows.length} employee{displayRows.length === 1 ? '' : 's'}
                  </span>
                  <span className="font-semibold text-text-primary">
                    {activeBatch ? 'Batch total' : 'Payroll total'}: <span className="text-[#047857]">{inr(totals.total)}</span>
                  </span>
                </div>
              ) : undefined
            }
          >
            {activeBatch && <p className="border-b border-border-default px-5 py-3 text-sm text-text-secondary">Bank batch details. Skipped employees are excluded from the batch amount; correct their bank details and rebuild a draft batch.</p>}
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="hidden sm:table-cell">Code</th>
                  <th className="hidden md:table-cell">Paid Days</th>
                  <th className="hidden md:table-cell">LOP</th>
                  {activeBatch && <><th>Bank account</th><th>Payment status</th></>}
                  <th className="text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {tableError ? <tr><td colSpan={activeBatch ? 7 : 5}><div role="alert" className="space-y-2 py-5 text-sm"><p>Unable to load {activeBatch ? 'bank batch details' : 'payroll employees'}.</p><HrButton variant="ghost" onClick={() => activeBatch ? refetchDetail() : refetchRows()}>Try again</HrButton></div></td></tr> : tableLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={activeBatch ? 7 : 5} className="py-3">
                        <div className="h-5 w-full animate-pulse rounded bg-bg-base" />
                      </td>
                    </tr>
                  ))
                ) : showEmpty ? (
                  <tr>
                    <td colSpan={activeBatch ? 7 : 5} className="py-14 text-center">
                      <p className="text-sm font-semibold text-text-secondary">{activeBatch ? 'No employees in this bank batch' : 'No payslips in this run'}</p>
                      <p className="mt-1 text-xs text-text-tertiary">
                        {selectedRun?.status === 'DRAFT'
                          ? 'Process the run to generate net-pay figures.'
                          : 'No employee payment lines are available for this period.'}
                      </p>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={activeBatch ? 7 : 5} className="py-12 text-center">
                      <p className="text-sm font-semibold text-text-secondary">No matches</p>
                      <p className="mt-1 text-xs text-text-tertiary">Try a different name or code.</p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr key={r.employeeId}>
                      <td>
                        <Link to={`/hrms/employees/${r.employeeId}`}><HrAvatar name={r.employeeName} sub={r.employeeCode || 'View employee'} seed={i} /></Link>
                        {r.failureReason && <p className="mt-1 max-w-xs text-xs text-red-700">{r.failureReason}</p>}
                      </td>
                      <td className="hidden sm:table-cell font-mono text-xs text-text-secondary">{r.employeeCode}</td>
                      <td className="hidden md:table-cell text-text-secondary">{r.paidDays ?? '—'}</td>
                      <td className="hidden md:table-cell text-text-secondary">{r.lopDays ?? '—'}</td>
                      {activeBatch && <><td className="font-mono text-xs">{r.bankLast4 ? `•••• ${r.bankLast4}` : 'Not available'}</td><td><HrStatusPill tone={r.status.startsWith('SKIPPED') ? 'red' : activeBatch.status === 'PAID' ? 'ok' : 'info'}>{r.status.startsWith('SKIPPED') ? 'Skipped' : activeBatch.status === 'PAID' ? 'Payment recorded' : 'Ready'}</HrStatusPill></td></>}
                      <td className="text-right font-semibold text-text-primary tabular-nums">{inr(r.netPay)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        </>
      )}

      {canReadBatches && <DisbursementHistory key={companyId} companyId={companyId || undefined} />}

    </div>
  )
}
