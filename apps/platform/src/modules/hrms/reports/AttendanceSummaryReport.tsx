import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useAttendanceSummaryReport } from '@/modules/hrms/api/useReports'
import { ReportShell, CompanySelector } from './ReportShell'
import { TableCard, HrAvatar, HrStatusPill } from '@/shared/components/hr'

function defaultFrom() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

export function AttendanceSummaryReport() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('company') ?? ''
  const from      = params.get('from')    ?? defaultFrom()
  const to        = params.get('to')      ?? new Date().toISOString().slice(0, 10)

  const set = (key: string, val: string) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set(key, val); return n })

  const { data = [], isLoading, error, refetch } = useAttendanceSummaryReport(companyId || null, from, to)

  // Chart: top 20 by late_days
  const chartData = [...data]
    .sort((a, b) => b.late_days - a.late_days)
    .slice(0, 20)
    .map((r) => ({ name: r.employee_name, 'Late Days': r.late_days, 'Present Days': r.present_days }))

  return (
    <ReportShell
      title="Attendance Summary"
      description="Present days, late days, average hours, and overtime per employee"
      companyId={companyId || null}
      isLoading={isLoading}
      error={error}
      hasData={data.length > 0}
      onRetry={refetch}
      filters={
        <>
          <CompanySelector value={companyId} onChange={(v) => set('company', v)} />
          <input
            type="date"
            value={from}
            onChange={(e) => set('from', e.target.value)}
            className="bg-white border border-border-default rounded-xl px-3 py-2.5 text-sm text-text-secondary focus:outline-none focus:border-[#FF9D00] transition-all"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => set('to', e.target.value)}
            className="bg-white border border-border-default rounded-xl px-3 py-2.5 text-sm text-text-secondary focus:outline-none focus:border-[#FF9D00] transition-all"
          />
        </>
      }
    >
      <div className="rounded-2xl border border-border-default bg-white p-5">
        <p className="text-xs text-text-tertiary mb-3">Top 20 by late days</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 80, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #E5E7EB)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary, #94a3b8)' }} width={80} />
            <Tooltip
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#111827' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Bar dataKey="Present Days" fill="#FF9D00" />
            <Bar dataKey="Late Days"    fill="#C2410C" />
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
              <th>Present Days</th>
              <th>Late Days</th>
              <th>Avg Hours</th>
              <th>Overtime (min)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={r.employee_code}>
                <td><span className="hr-mono">{r.employee_code}</span></td>
                <td><HrAvatar name={r.employee_name} seed={i} /></td>
                <td>{r.department ?? '—'}</td>
                <td>{r.present_days}</td>
                <td>{r.late_days > 0 ? <HrStatusPill tone="late">{r.late_days}</HrStatusPill> : r.late_days}</td>
                <td>{r.avg_hours != null ? r.avg_hours.toFixed(1) : '—'}</td>
                <td>{r.total_overtime_mins}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </ReportShell>
  )
}
