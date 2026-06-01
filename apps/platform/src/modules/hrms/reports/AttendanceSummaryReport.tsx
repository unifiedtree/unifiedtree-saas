import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { DataTable } from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { useAttendanceSummaryReport } from '@/modules/hrms/api/useReports'
import type { AttendanceSummaryRow } from '@/modules/hrms/api/useReports'
import { ReportShell, CompanySelector } from './ReportShell'

function defaultFrom() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

const COLUMNS: Column<AttendanceSummaryRow>[] = [
  { key: 'employee_code',      header: 'Emp Code',      cell: (r) => <span className="font-mono text-xs">{r.employee_code}</span> },
  { key: 'employee_name',      header: 'Name',          cell: (r) => r.employee_name },
  { key: 'department',         header: 'Department',    cell: (r) => r.department ?? '—' },
  { key: 'present_days',       header: 'Present Days',  cell: (r) => r.present_days },
  { key: 'late_days',          header: 'Late Days',     cell: (r) => r.late_days },
  { key: 'avg_hours',          header: 'Avg Hours',     cell: (r) => r.avg_hours != null ? r.avg_hours.toFixed(1) : '—' },
  { key: 'total_overtime_mins',header: 'Overtime (min)', cell: (r) => r.total_overtime_mins },
]

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
            className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 transition-all"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => set('to', e.target.value)}
            className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 transition-all"
          />
        </>
      }
    >
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
        <p className="text-xs text-[#64748B] mb-3">Top 20 by late days</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 80, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #334155)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary, #94a3b8)' }} width={80} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Bar dataKey="Present Days" fill="var(--color-accent-default, #6366f1)" />
            <Bar dataKey="Late Days"    fill="var(--color-status-warning-fg, #f59e0b)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <DataTable
        columns={COLUMNS}
        data={data}
        getRowKey={(r) => r.employee_code}
        emptyTitle="No attendance data"
        emptyDescription="No attendance records found for the selected period."
      />
    </ReportShell>
  )
}
