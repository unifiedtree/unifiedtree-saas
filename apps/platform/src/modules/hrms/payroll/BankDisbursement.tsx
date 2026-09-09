import React, { useEffect, useMemo, useState } from 'react'
import { Banknote, Users, Wallet, ListChecks, Landmark, Download, Plus, Trash2, CheckCircle2, XCircle, Building2 } from 'lucide-react'
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
  useBankProfiles, useCreateBankProfile, useDeleteBankProfile,
  useDisbursementBatches, useBuildBatch, useDownloadBatchFile,
  useMarkBatchPaid, useCancelBatch,
  BANK_FORMATS, IFSC_PATTERN,
  type BankFormat, type BatchStatus,
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

  const { data: rows = [], isLoading: rowsLoading } = useRunEmployees(runId)

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + (r.netPay ?? 0), 0)
    const count = rows.length
    const avg = count > 0 ? total / count : 0
    return { total, count, avg }
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q),
    )
  }, [rows, query])

  const bandData = useMemo(
    () =>
      BANDS.map((b) => ({
        label: b.label,
        count: rows.filter((r) => (r.netPay ?? 0) >= b.min && (r.netPay ?? 0) < b.max).length,
      })),
    [rows],
  )

  const hasRun = !!selectedRun
  const showEmpty = hasRun && !rowsLoading && rows.length === 0

  // ── Bank profiles + batches for the selected (company, run) ───────────────
  const effectiveCompanyId = companyId || selectedRun?.companyId || ''
  const { data: profiles = [] } = useBankProfiles(
    effectiveCompanyId || undefined,
    { enabled: canReadProfile && !!effectiveCompanyId },
  )
  const { data: batches = [] } = useDisbursementBatches(
    runId ? { runId } : {},
    { enabled: canReadBatches && !!runId },
  )
  // The pre-existing (DRAFT/POSTED/PAID) batch for this run, if any — the
  // server enforces one live batch per (run, profile); we display the most
  // recent that is not CANCELLED so operators see the state their button
  // clicks will act on.
  const activeBatch = useMemo(
    () => batches.find((b) => b.status !== 'CANCELLED') ?? null,
    [batches],
  )

  // ── Batch mutations ────────────────────────────────────────────────────────
  const buildBatch = useBuildBatch()
  const downloadBatch = useDownloadBatchFile()
  const markPaid = useMarkBatchPaid()
  const cancelBatch = useCancelBatch()
  const createProfile = useCreateBankProfile()
  const deleteProfile = useDeleteBankProfile()

  const [showProfileForm, setShowProfileForm] = useState(false)
  const [profileName, setProfileName]         = useState('')
  const [bankFormat, setBankFormat]           = useState<BankFormat>('GENERIC_CSV')
  const [corporateId, setCorporateId]         = useState('')
  const [debitAccountNo, setDebitAccountNo]   = useState('')
  const [ifsc, setIfsc]                       = useState('')
  const [profileIsDefault, setProfileIsDefault] = useState(false)

  const [selectedProfileId, setSelectedProfileId] = useState('')
  useEffect(() => {
    if (profiles.length === 0) { if (selectedProfileId) setSelectedProfileId(''); return }
    if (!profiles.some((p) => p.id === selectedProfileId)) {
      setSelectedProfileId(profiles.find((p) => p.isDefault && p.isActive)?.id ?? profiles[0].id)
    }
  }, [profiles, selectedProfileId])

  const onCreateProfile = async () => {
    if (!effectiveCompanyId) { toast('Pick a company first', 'error'); return }
    if (!profileName.trim()) { toast('Profile name is required', 'error'); return }
    if (!debitAccountNo.trim()) { toast('Debit account number is required', 'error'); return }
    if (!IFSC_PATTERN.test(ifsc.trim().toUpperCase())) {
      // Fail early with the same message shape the server would return, so the
      // operator doesn't wait a round-trip to learn the code is malformed.
      toast('IFSC must look like ABCD0XXXXXX (11 chars, 5th is zero)', 'error'); return
    }
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
      setShowProfileForm(false)
      setProfileName(''); setCorporateId(''); setDebitAccountNo(''); setIfsc('')
      setProfileIsDefault(false); setBankFormat('GENERIC_CSV')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to create bank profile', 'error')
    }
  }

  const onDeleteProfile = async (id: string, name: string) => {
    if (!window.confirm(`Delete bank profile "${name}"? Existing batches keep their reference; new batches can no longer use it.`)) return
    try {
      await deleteProfile.mutateAsync(id)
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
        subtitle="Net-pay advice for the bank — pick a payroll run to review what gets credited."
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
              <HrButton variant={showProfileForm ? 'ghost' : 'primary'} size="sm" onClick={() => setShowProfileForm((s) => !s)}>
                <Plus size={14} /> {showProfileForm ? 'Close' : 'Add profile'}
              </HrButton>
            )}
          </div>

          {showProfileForm && canManageProfile && (
            <div className="mb-4 rounded-xl border border-border-default bg-white p-4">
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Profile name *</label>
                  <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. HDFC Payroll Salary A/C" className="ut-input" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Bank format *</label>
                  <select value={bankFormat} onChange={(e) => setBankFormat(e.target.value as BankFormat)} className="ut-select">
                    {BANK_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
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
              <div className="mt-4 flex justify-end border-t border-border-default pt-3">
                <HrButton size="sm" onClick={onCreateProfile} disabled={createProfile.isPending}>
                  {createProfile.isPending ? 'Saving…' : 'Save profile'}
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
                          <div className="flex justify-end">
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
                    {activeBatch
                      ? <>Batch <span className="font-mono">{activeBatch.batchReference}</span> · {activeBatch.beneficiaryCount} beneficiaries · {inr(activeBatch.totalAmount)}</>
                      : selectedRun?.status === 'LOCKED'
                        ? 'No batch built yet — pick a bank profile and click Build.'
                        : `Payroll run is ${selectedRun?.status}. Only LOCKED runs can be disbursed.`}
                  </p>
                </div>
                {activeBatch && <HrStatusPill tone={BATCH_TONE[activeBatch.status]}>{activeBatch.status}</HrStatusPill>}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                {!activeBatch && canBuildBatch && (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Bank profile</label>
                      <select
                        value={selectedProfileId}
                        onChange={(e) => setSelectedProfileId(e.target.value)}
                        disabled={profiles.length === 0}
                        className="min-w-[220px] rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20 disabled:opacity-50"
                      >
                        {profiles.length === 0 && <option value="">No profiles — add one above</option>}
                        {profiles.filter((p) => p.isActive).map((p) => (
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
                  <HrButton onClick={onDownloadBatchFile} disabled={downloadBatch.isPending}>
                    <Download size={15} /> {downloadBatch.isPending ? 'Downloading…' : (activeBatch.status === 'DRAFT' ? 'Download bank file (posts batch)' : 'Re-download bank file')}
                  </HrButton>
                )}

                {activeBatch && canPostBatch && activeBatch.status === 'POSTED' && (
                  <HrButton variant="primary" onClick={onMarkPaid} disabled={markPaid.isPending}>
                    <CheckCircle2 size={15} /> {markPaid.isPending ? 'Marking…' : 'Mark paid (UTR)'}
                  </HrButton>
                )}

                {activeBatch && canPostBatch && (activeBatch.status === 'DRAFT' || activeBatch.status === 'POSTED') && (
                  <HrButton variant="ghost" onClick={onCancelBatch} disabled={cancelBatch.isPending}>
                    <XCircle size={15} /> Cancel batch
                  </HrButton>
                )}
              </div>

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
              label="Total Disbursement"
              sub={selectedRun ? `${MONTHS[selectedRun.periodMonth - 1]} ${selectedRun.periodYear}` : undefined}
              loading={rowsLoading}
            />
            <HrStatCard
              icon={<Users size={18} />}
              color="blue"
              value={totals.count}
              label="Employees"
              sub="credited this run"
              loading={rowsLoading}
            />
            <HrStatCard
              icon={<Wallet size={18} />}
              color="teal"
              value={inr(totals.avg)}
              label="Average Net Pay"
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
              !rowsLoading && rows.length > 0 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">
                    {filtered.length} of {rows.length} employee{rows.length === 1 ? '' : 's'}
                  </span>
                  <span className="font-semibold text-text-primary">
                    Total to credit: <span className="text-[#047857]">{inr(totals.total)}</span>
                  </span>
                </div>
              ) : undefined
            }
          >
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="hidden sm:table-cell">Code</th>
                  <th className="hidden md:table-cell">Paid Days</th>
                  <th className="hidden md:table-cell">LOP</th>
                  <th className="text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {rowsLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="py-3">
                        <div className="h-5 w-full animate-pulse rounded bg-bg-base" />
                      </td>
                    </tr>
                  ))
                ) : showEmpty ? (
                  <tr>
                    <td colSpan={5} className="py-14 text-center">
                      <p className="text-sm font-semibold text-text-secondary">No payslips in this run</p>
                      <p className="mt-1 text-xs text-text-tertiary">
                        {selectedRun?.status === 'DRAFT'
                          ? 'Process the run to generate net-pay figures.'
                          : 'No eligible employees were paid for this period.'}
                      </p>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <p className="text-sm font-semibold text-text-secondary">No matches</p>
                      <p className="mt-1 text-xs text-text-tertiary">Try a different name or code.</p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr key={r.employeeId}>
                      <td>
                        <HrAvatar name={r.employeeName} sub={`${r.paidDays} paid · ${r.lopDays} LOP`} seed={i} />
                      </td>
                      <td className="hidden sm:table-cell font-mono text-xs text-text-secondary">{r.employeeCode}</td>
                      <td className="hidden md:table-cell text-text-secondary">{r.paidDays}</td>
                      <td className="hidden md:table-cell text-text-secondary">{r.lopDays}</td>
                      <td className="text-right font-semibold text-text-primary tabular-nums">{inr(r.netPay)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        </>
      )}
    </div>
  )
}
