import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useLeaveBalanceReport } from '@/modules/hrms/api/useReports'
import type { LeaveBalanceRow } from '@/modules/hrms/api/useReports'
import { TableCard, HrAvatar } from '@/shared/components/hr'
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
            className="bg-white border border-border-default rounded-xl px-3 py-2.5 text-sm text-text-secondary focus:outline-none focus:border-[#FF9D00] transition-all"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </>
      }
    >
      <div className="rounded-2xl border border-border-default bg-white p-5">
        <p className="text-xs text-text-tertiary mb-3">Top 20 by leave used (summed across types)</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #FFD68A)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary, #94a3b8)' }} interval={0} angle={-35} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #FFD68A', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#0F172A' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="used"      fill="#EF4444" />
            <Bar dataKey="pending"   fill="#FF9D00" />
            <Bar dataKey="available" fill="#22C55E" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Emp Code</th>
              <th>Name</th>
              <th>Department</th>
              <th>Leave Type</th>
              <th>Entitled</th>
              <th>Used</th>
              <th>Pending</th>
              <th>Carry Fwd</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={`${r.employee_code}-${r.leave_type}`}>
                <td><span className="hr-mono">{r.employee_code}</span></td>
                <td><HrAvatar name={r.employee_name} seed={i} /></td>
                <td>{r.department ?? '—'}</td>
                <td>{r.leave_type}</td>
                <td>{r.total_entitlement}</td>
                <td>{r.used}</td>
                <td>{r.pending}</td>
                <td>{r.carry_forward}</td>
                <td>{r.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </ReportShell>
  )
}
