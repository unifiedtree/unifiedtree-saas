import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { DataTable } from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { useLeaveBalanceReport } from '@/modules/hrms/api/useReports'
import type { LeaveBalanceRow } from '@/modules/hrms/api/useReports'
import { ReportShell, CompanySelector } from './ReportShell'

const CURRENT_YEAR = String(new Date().getFullYear())

// Aggregate by employee for the chart (sum across leave types)
function aggregateByEmployee(rows: LeaveBalanceRow[]) {
  const map = new Map<string, { name: string; available: number; used: number; pending: number }>()
  for (const r of rows) {
    const key = r.employee_code
    const existing = map.get(key)
    if (existing) {
      existing.available += r.available
      existing.used      += r.used
      existing.pending   += r.pending
    } else {
      map.set(key, { name: r.employee_name, available: r.available, used: r.used, pending: r.pending })
    }
  }
  return [...map.values()].sort((a, b) => b.used - a.used).slice(0, 20)
}

const COLUMNS: Column<LeaveBalanceRow>[] = [
  { key: 'employee_code',    header: 'Emp Code',     cell: (r) => <span className="font-mono text-xs">{r.employee_code}</span> },
  { key: 'employee_name',    header: 'Name',         cell: (r) => r.employee_name },
  { key: 'department',       header: 'Department',   cell: (r) => r.department ?? '—' },
  { key: 'leave_type',       header: 'Leave Type',   cell: (r) => r.leave_type },
  { key: 'total_entitlement',header: 'Entitled',     cell: (r) => r.total_entitlement },
  { key: 'used',             header: 'Used',         cell: (r) => r.used },
  { key: 'pending',          header: 'Pending',      cell: (r) => r.pending },
  { key: 'carry_forward',    header: 'Carry Fwd',    cell: (r) => r.carry_forward },
  { key: 'available',        header: 'Available',    cell: (r) => r.available },
]

export function LeaveBalanceReport() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('company') ?? ''
  const year      = params.get('year')    ?? CURRENT_YEAR

  const set = (key: string, val: string) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set(key, val); return n })

  const { data = [], isLoading, error, refetch } = useLeaveBalanceReport(companyId || null, year)

  const chartData = aggregateByEmployee(data)

  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i))

  return (
    <ReportShell
      title="Leave Balance Report"
      description="Leave entitlement, used, pending, carry-forward, and available days per employee"
      companyId={companyId || null}
      isLoading={isLoading}
      error={error}
      hasData={data.length > 0}
      onRetry={refetch}
      filters={
        <>
          <CompanySelector value={companyId} onChange={(v) => set('company', v)} />
          <select
            value={year}
            onChange={(e) => set('year', e.target.value)}
            className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 transition-all"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </>
      }
    >
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
        <p className="text-xs text-[#64748B] mb-3">Top 20 by leave used (summed across types)</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #334155)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary, #94a3b8)' }} interval={0} angle={-35} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Bar dataKey="used"      fill="var(--color-status-danger-fg, #ef4444)" />
            <Bar dataKey="pending"   fill="var(--color-status-warning-fg, #f59e0b)" />
            <Bar dataKey="available" fill="var(--color-status-success-fg, #22c55e)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <DataTable
        columns={COLUMNS}
        data={data}
        getRowKey={(r) => `${r.employee_code}-${r.leave_type}`}
        emptyTitle="No leave balance data"
        emptyDescription="No leave balances found for the selected year."
      />
    </ReportShell>
  )
}
