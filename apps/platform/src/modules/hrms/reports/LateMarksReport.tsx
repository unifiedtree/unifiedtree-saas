import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { DataTable } from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { useLateMarksReport } from '@/modules/hrms/api/useReports'
import type { LateMarkRow } from '@/modules/hrms/api/useReports'
import { ReportShell, CompanySelector } from './ReportShell'

function defaultFrom() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

// Top offenders aggregated by employee
function aggregateByEmployee(rows: LateMarkRow[]) {
  const map = new Map<string, { name: string; count: number; totalMins: number }>()
  for (const r of rows) {
    const key = r.employee_code
    const existing = map.get(key)
    if (existing) {
      existing.count++
      existing.totalMins += r.late_by_minutes
    } else {
      map.set(key, { name: r.employee_name, count: 1, totalMins: r.late_by_minutes })
    }
  }
  return [...map.values()].sort((a, b) => b.totalMins - a.totalMins).slice(0, 15)
}

const COLUMNS: Column<LateMarkRow>[] = [
  { key: 'employee_code',   header: 'Emp Code',   cell: (r) => <span className="font-mono text-xs">{r.employee_code}</span> },
  { key: 'employee_name',   header: 'Name',       cell: (r) => r.employee_name },
  { key: 'department',      header: 'Department', cell: (r) => r.department ?? '—' },
  { key: 'attendance_date', header: 'Date',       cell: (r) => r.attendance_date },
  { key: 'late_by_minutes', header: 'Late (min)', cell: (r) => r.late_by_minutes },
  { key: 'check_in_at',     header: 'Check-in',  cell: (r) => r.check_in_at ?? '—' },
]

export function LateMarksReport() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('company') ?? ''
  const from      = params.get('from')    ?? defaultFrom()
  const to        = params.get('to')      ?? new Date().toISOString().slice(0, 10)

  const set = (key: string, val: string) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set(key, val); return n })

  const { data = [], isLoading, error, refetch } = useLateMarksReport(companyId || null, from, to)

  const chartData = aggregateByEmployee(data).map((r) => ({
    name: r.name,
    'Total Late (min)': r.totalMins,
    'Occurrences': r.count,
  }))

  return (
    <ReportShell
      title="Late Marks Report"
      description="All late-arrival records with minutes late and check-in time"
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
        <p className="text-xs text-[#64748B] mb-3">Top 15 offenders by total minutes late</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 90, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #334155)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary, #94a3b8)' }} width={90} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Bar dataKey="Total Late (min)" fill="var(--color-status-danger-fg, #ef4444)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <DataTable
        columns={COLUMNS}
        data={data}
        getRowKey={(r) => `${r.employee_code}-${r.attendance_date}`}
        emptyTitle="No late marks"
        emptyDescription="No late arrivals recorded in the selected period."
      />
    </ReportShell>
  )
}
