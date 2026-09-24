import React, { useMemo } from 'react'
import { format } from 'date-fns'
import { Plus, Users, Calculator, Wallet, CheckCircle, Clock, Banknote, FileWarning } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrButton, type PillTone,
} from '@/shared/components/hr'
import { DataTable } from '@/shared/components/DataTable'
import { useRuns, inr, MONTHS, type PayrollRun, type RunStatus } from '../api/usePayrollRuns'
// Client rule: rupee KPIs + cost-trend chart are admin/finance-only. HR (and
// anyone lower) sees the redacted "—" placeholder instead of the actual money.
// The recent-runs table stays visible because the sidebar/route already gates
// entry to this page on R_FIN_RUPEE — non-admins here are edge cases who
// arrived via a stale bookmark or an HR-only permission upgrade.
import { useRoles } from '@/shared/hooks/useRoles'
// Wave 1 (2026-08-11): the four KPI tiles + cost trend are now backed by real
// backend aggregates — the previous client-side reductions over the loaded
// runs list under-counted (they missed employer contributions) and disagreed
// with the payslip PDFs. New endpoints: /v1/payroll/dashboard/kpis + /trend.
import { usePayrollDashboardKpis, usePayrollCostTrend } from '../api/usePayroll'

// Map payroll run status → client pill tone (statusTone from the hook targets a
// different pill set, so we map explicitly to the HrStatusPill palette here).
const RUN_TONE: Record<RunStatus, PillTone> = {
  DRAFT: 'gray',
  PROCESSING: 'info',
  LOCKED: 'teal',
  PAID: 'ok',
  CANCELLED: 'red',
}

const STATUS_ORDER: RunStatus[] = ['DRAFT', 'PROCESSING', 'LOCKED', 'PAID', 'CANCELLED']

const STATUS_COLOR: Record<RunStatus, string> = {
  DRAFT: '#94A3B8',
  PROCESSING: '#2563EB',
  LOCKED: '#06B6D4',
  PAID: '#22C55E',
  CANCELLED: '#EF4444',
}

const periodLabel = (r: PayrollRun) => `${MONTHS[r.periodMonth - 1] ?? '?'} ${r.periodYear}`

// Chronological sort key: year * 12 + month.
const chronoKey = (r: PayrollRun) => r.periodYear * 12 + r.periodMonth

export const PayrollDashboard: React.FC = () => {
  const { data, isLoading } = useRuns()
  const runs = useMemo(() => data ?? [], [data])
  const { isAdmin } = useRoles()

  // Backend-computed KPIs + trend (Wave 1). The runs list stays for the
  // status-breakdown + recent-runs table — that's still a purely client-side
  // rollup over the currently visible page of runs.
  //
  // Skip the rupee fetches entirely for non-admins so we don't hit the KPI
  // endpoint that would 403 anyway (usePayroll hooks share a queryClient with
  // other rupee-adjacent pages — silencing the fetch keeps devtools quiet).
  const { data: kpis, isLoading: kpisLoading } = usePayrollDashboardKpis({ enabled: isAdmin })
  const { data: trend, isLoading: trendLoading } = usePayrollCostTrend(6, { enabled: isAdmin })

  // Newest-first by period, used for "latest run" and the recent-runs table.
  const byPeriodDesc = useMemo(
    () => [...runs].sort((a, b) => chronoKey(b) - chronoKey(a)),
    [runs],
  )

  // Status breakdown across all loaded runs.
  const statusCounts = useMemo(() => {
    const m = new Map<RunStatus, number>()
    for (const r of runs) m.set(r.status, (m.get(r.status) ?? 0) + 1)
    return STATUS_ORDER
      .map((s) => ({ status: s, count: m.get(s) ?? 0 }))
      .filter((x) => x.count > 0)
  }, [runs])

  const hasRuns = runs.length > 0
  const chartData = useMemo(
    () => (trend ?? []).map((p) => ({ label: p.label, totalCost: p.totalPayrollCost })),
    [trend],
  )

  // Non-admin viewers get every rupee KPI + the 6-month trend chart redacted
  // to "—" / "Restricted". "Pending Disbursals" is a raw run count (not
  // rupees), so it stays visible even for HR — the number carries no
  // salary-value signal on its own.
  const redactRupees = !isAdmin

  // TDS Liability is the backend's sum of payslip lines coded "TDS". The
  // payroll engine does not compute TDS, so the sum is only non-zero when a
  // TDS component actually lands on payslips — a bare ₹0 would read as
  // "no tax due". Show "—" and say why instead; keep the real sum otherwise.
  const tdsAmount = kpis ? Number(kpis.tdsLiability ?? 0) : 0
  const hasTds = tdsAmount !== 0

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Payroll"
        title="Payroll Dashboard"
        subtitle={
          redactRupees
            ? 'Payroll cost figures are restricted to admin / finance roles'
            : kpis
              ? `Live aggregates for ${kpis.currentPeriodLabel} across all your payroll runs`
              : 'Cost, headcount, and disbursal status across your payroll runs'
        }
        actions={
          <div className="flex gap-2">
            <HrButton>
              <Plus size={16} /> Run Payroll Cycle
            </HrButton>
          </div>
        }
      />

      {/* KPI cards — backed by /v1/payroll/dashboard/kpis. Rupee KPIs render
          as "—" for non-admins; only the run-count tile shows a real value. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HrStatCard
          icon={<Wallet size={18} />}
          color="green"
          loading={kpisLoading && !redactRupees}
          value={redactRupees ? '—' : (kpis ? inr(kpis.totalPayrollCost) : '—')}
          label="Total Payroll Cost"
          sub={redactRupees ? 'Restricted' : (kpis ? kpis.currentPeriodLabel : 'No runs yet')}
        />
        <HrStatCard
          icon={<Users size={18} />}
          color="purple"
          loading={kpisLoading && !redactRupees}
          value={redactRupees ? '—' : (kpis ? inr(kpis.averageSalary) : '—')}
          label="Average Salary"
          sub={redactRupees ? 'Restricted' : (kpis ? kpis.currentPeriodLabel : 'No runs yet')}
        />
        <HrStatCard
          icon={<FileWarning size={18} />}
          color="orange"
          loading={kpisLoading && !redactRupees}
          value={redactRupees ? '—' : (kpis ? kpis.pendingDisbursals : '—')}
          label="Pending Disbursals"
          sub="Locked / processing runs not yet paid"
        />
        <HrStatCard
          icon={<Banknote size={18} />}
          color="blue"
          loading={kpisLoading && !redactRupees}
          value={redactRupees ? '—' : (kpis && hasTds ? inr(tdsAmount) : '—')}
          label="TDS Liability"
          sub={
            redactRupees
              ? 'Restricted'
              : !kpis
                ? 'No runs yet'
                : hasTds
                  ? kpis.currentPeriodLabel
                  : `No TDS component on ${kpis.currentPeriodLabel} payslips`
          }
        />
      </div>

      {/* Chart + status breakdown */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 6-month cost trend — backed by /v1/payroll/dashboard/trend */}
        <div className="ut-card lg:col-span-2 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Payroll Cost — Last 6 Months</h2>
              <p className="text-xs text-text-tertiary">Total cost including employer contributions</p>
            </div>
          </div>
          {redactRupees ? (
            // Same footprint as the chart so the surrounding grid doesn't reflow.
            <div className="flex h-[260px] flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold text-text-secondary">—</p>
              <p className="mt-1 text-xs text-text-tertiary">Payroll cost trend is restricted to admin / finance roles.</p>
            </div>
          ) : trendLoading ? (
            <div className="h-[260px] animate-pulse rounded-lg bg-bg-base" />
          ) : chartData.length === 0 ? (
            <div className="flex h-[260px] flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold text-text-secondary">No payroll runs yet</p>
              <p className="mt-1 text-xs text-text-tertiary">Create a run to see cost trends.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v) => inr(Number(v))}
                />
                <Tooltip
                  formatter={(v: number | string) => [inr(Number(v)), 'Total Cost']}
                  cursor={{ fill: 'rgba(5, 150, 105,0.06)' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 12 }}
                />
                <Bar dataKey="totalCost" radius={[6, 6, 0, 0]} maxBarSize={48} fill="#059669" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status breakdown */}
        <div className="ut-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-text-primary">Run Status Breakdown</h2>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-bg-base" />)}
            </div>
          ) : statusCounts.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold text-text-secondary">Nothing to show</p>
              <p className="mt-1 text-xs text-text-tertiary">Run statuses appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {statusCounts.map(({ status, count }) => {
                const pct = hasRuns ? Math.round((count / runs.length) * 100) : 0
                return (
                  <div key={status}>
                    <div className="mb-1 flex items-center justify-between">
                      <HrStatusPill tone={RUN_TONE[status]}>{status}</HrStatusPill>
                      <span className="text-xs font-semibold text-text-secondary">{count} · {pct}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-bg-base">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: STATUS_COLOR[status] }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent runs table */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Recent Runs</h2>
        </div>
        <TableCard>
          <DataTable
            columns={[
              { key: 'period', header: 'Period', render: (r) => <span className="font-semibold text-text-primary">{periodLabel(r)}</span> },
              { key: 'company', header: 'Company', render: (r) => <span className="text-text-secondary">{r.companyName}</span> },
              { key: 'status', header: 'Status', render: (r) => <HrStatusPill tone={RUN_TONE[r.status]}>{r.status}</HrStatusPill> },
              { key: 'employees', header: 'Employees', render: (r) => <div className="text-right text-text-secondary">{r.employeeCount}</div> },
              { key: 'netPay', header: 'Net Pay', render: (r) => <div className="text-right font-semibold text-text-primary">{redactRupees ? '—' : inr(r.totalNet)}</div> },
              { key: 'processed', header: 'Processed', render: (r) => <div className="text-right text-text-secondary">{r.processedAt ? format(new Date(r.processedAt), 'd MMM yyyy') : '—'}</div> }
            ]}
            data={byPeriodDesc.slice(0, 10)}
            keyField="id"
            loading={isLoading}
            emptyMessage="No payroll runs yet. Runs you create will appear here."
          />
        </TableCard>
      </div>
    </div>
  )
}
