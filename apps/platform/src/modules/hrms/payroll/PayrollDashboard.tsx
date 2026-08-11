import React, { useMemo } from 'react'
import { format } from 'date-fns'
import { Wallet, Users, Banknote, FileWarning } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, type PillTone,
} from '@/shared/components/hr'
import { useRuns, inr, MONTHS, type PayrollRun, type RunStatus } from '../api/usePayrollRuns'
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

  // Backend-computed KPIs + trend (Wave 1). The runs list stays for the
  // status-breakdown + recent-runs table — that's still a purely client-side
  // rollup over the currently visible page of runs.
  const { data: kpis, isLoading: kpisLoading } = usePayrollDashboardKpis()
  const { data: trend, isLoading: trendLoading } = usePayrollCostTrend(6)

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

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Payroll"
        title="Payroll Dashboard"
        subtitle={
          kpis
            ? `Live aggregates for ${kpis.currentPeriodLabel} across all your payroll runs`
            : 'Cost, headcount, and disbursal status across your payroll runs'
        }
      />

      {/* KPI cards — backed by /v1/payroll/dashboard/kpis */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HrStatCard
          icon={<Wallet size={18} />}
          color="green"
          loading={kpisLoading}
          value={kpis ? inr(kpis.totalPayrollCost) : '—'}
          label="Total Payroll Cost"
          sub={kpis ? kpis.currentPeriodLabel : 'No runs yet'}
        />
        <HrStatCard
          icon={<Users size={18} />}
          color="purple"
          loading={kpisLoading}
          value={kpis ? inr(kpis.averageSalary) : '—'}
          label="Average Salary"
          sub={kpis ? kpis.currentPeriodLabel : 'No runs yet'}
        />
        <HrStatCard
          icon={<FileWarning size={18} />}
          color="orange"
          loading={kpisLoading}
          value={kpis ? kpis.pendingDisbursals : '—'}
          label="Pending Disbursals"
          sub="Locked / processing runs not yet paid"
        />
        <HrStatCard
          icon={<Banknote size={18} />}
          color="blue"
          loading={kpisLoading}
          value={kpis ? inr(kpis.tdsLiability) : '—'}
          label="TDS Liability"
          sub={kpis ? kpis.currentPeriodLabel : 'No runs yet'}
        />
      </div>

      {/* Chart + status breakdown */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 6-month cost trend — backed by /v1/payroll/dashboard/trend */}
        <div className="lg:col-span-2 rounded-xl border border-border-default bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Payroll Cost — Last 6 Months</h2>
              <p className="text-xs text-text-tertiary">Total cost including employer contributions</p>
            </div>
          </div>
          {trendLoading ? (
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
        <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
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
          <table className="hr-table">
            <thead>
              <tr>
                <th>Period</th>
                <th className="hidden sm:table-cell">Company</th>
                <th>Status</th>
                <th className="text-right">Employees</th>
                <th className="text-right">Net Pay</th>
                <th className="hidden md:table-cell text-right">Processed</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>
                ))
              ) : byPeriodDesc.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-14 text-center">
                    <p className="text-sm font-semibold text-text-secondary">No payroll runs yet</p>
                    <p className="mt-1 text-xs text-text-tertiary">Runs you create will appear here.</p>
                  </td>
                </tr>
              ) : byPeriodDesc.slice(0, 10).map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold text-text-primary">{periodLabel(r)}</td>
                  <td className="hidden sm:table-cell text-text-secondary">{r.companyName}</td>
                  <td><HrStatusPill tone={RUN_TONE[r.status]}>{r.status}</HrStatusPill></td>
                  <td className="text-right text-text-secondary">{r.employeeCount}</td>
                  <td className="text-right font-semibold text-text-primary">{inr(r.totalNet)}</td>
                  <td className="hidden md:table-cell text-right text-text-secondary">
                    {r.processedAt ? format(new Date(r.processedAt), 'd MMM yyyy') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </div>
    </div>
  )
}
