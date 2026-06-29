import React, { useEffect, useMemo, useState } from 'react'
import { Banknote, Users, Wallet, ListChecks, Landmark, Download } from 'lucide-react'
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

// Map payroll run status → client status-pill tone.
const STATUS_TONE: Record<RunStatus, PillTone> = {
  DRAFT: 'gray',
  PROCESSING: 'info',
  LOCKED: 'purple',
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
            className="min-w-[200px] rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20"
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
            className="min-w-[260px] rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20 disabled:opacity-50"
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

      {hasRun && (
        <>
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
            <div className="mb-5 rounded-xl border border-border-default bg-white p-5 shadow-sm">
              <p className="mb-4 text-sm font-semibold text-text-primary">Net-pay distribution</p>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bandData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,157,0,0.06)' }}
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
                    Total to credit: <span className="text-[#C16E00]">{inr(totals.total)}</span>
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
