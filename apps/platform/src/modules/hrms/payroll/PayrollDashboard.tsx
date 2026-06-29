import React, { useMemo } from 'react'
import { format } from 'date-fns'
import { Layers, Wallet, Users, Banknote } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, type PillTone,
} from '@/shared/components/hr'
import { useRuns, inr, MONTHS, type PayrollRun, type RunStatus } from '../api/usePayrollRuns'

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

  // Newest-first by period, used for "latest run" and the recent-runs table.
  const byPeriodDesc = useMemo(
    () => [...runs].sort((a, b) => chronoKey(b) - chronoKey(a)),
    [runs],
  )
  const latest = byPeriodDesc[0]

  const totalNet = useMemo(() => runs.reduce((s, r) => s + (r.totalNet ?? 0), 0), [runs])

  // Bar chart: net pay per period, oldest → newest, capped to the last 12 periods.
  const chartData = useMemo(() => {
    return [...runs]
      .sort((a, b) => chronoKey(a) - chronoKey(b))
      .slice(-12)
      .map((r) => ({
        label: `${MONTHS[r.periodMonth - 1] ?? '?'} ${String(r.periodYear).slice(-2)}`,
        totalNet: r.totalNet ?? 0,
        status: r.status,
      }))
  }, [runs])

  // Status breakdown across all loaded runs.
  const statusCounts = useMemo(() => {
    const m = new Map<RunStatus, number>()
    for (const r of runs) m.set(r.status, (m.get(r.status) ?? 0) + 1)
    return STATUS_ORDER
      .map((s) => ({ status: s, count: m.get(s) ?? 0 }))
      .filter((x) => x.count > 0)
  }, [runs])

  const hasRuns = runs.length > 0

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Payroll"
        title="Payroll Dashboard"
        subtitle="Net pay, run status, and period trends across your payroll runs"
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HrStatCard
          icon={<Layers size={18} />}
          color="blue"
          loading={isLoading}
          value={runs.length}
          label="Total Runs"
          sub="Loaded payroll runs"
        />
        <HrStatCard
          icon={<Wallet size={18} />}
          color="green"
          loading={isLoading}
          value={latest ? inr(latest.totalNet) : '—'}
          label="Latest Run Net Pay"
          sub={latest ? periodLabel(latest) : 'No runs yet'}
        />
        <HrStatCard
          icon={<Users size={18} />}
          color="purple"
          loading={isLoading}
          value={latest ? latest.employeeCount : '—'}
          label="Employees (Latest Run)"
          sub={latest ? `${latest.companyName}` : 'No runs yet'}
        />
        <HrStatCard
          icon={<Banknote size={18} />}
          color="orange"
          loading={isLoading}
          value={inr(totalNet)}
          label="Total Net (Loaded)"
          sub={`Across ${runs.length} run${runs.length === 1 ? '' : 's'}`}
        />
      </div>

      {/* Chart + status breakdown */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Net pay by period */}
        <div className="lg:col-span-2 rounded-xl border border-border-default bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Net Pay by Period</h2>
              <p className="text-xs text-text-tertiary">Last {chartData.length} period{chartData.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          {isLoading ? (
            <div className="h-[260px] animate-pulse rounded-lg bg-bg-base" />
          ) : chartData.length === 0 ? (
            <div className="flex h-[260px] flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold text-text-secondary">No payroll runs yet</p>
              <p className="mt-1 text-xs text-text-tertiary">Create a run to see net pay trends.</p>
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
                  formatter={(v: number | string) => [inr(Number(v)), 'Net Pay']}
                  cursor={{ fill: 'rgba(255,157,0,0.06)' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 12 }}
                />
                <Bar dataKey="totalNet" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={STATUS_COLOR[d.status] ?? '#FF9D00'} />
                  ))}
                </Bar>
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
