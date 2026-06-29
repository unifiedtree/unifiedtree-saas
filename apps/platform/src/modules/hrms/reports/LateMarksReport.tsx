import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { useLateMarksReport } from '@/modules/hrms/api/useReports'
import type { LateMarkRow } from '@/modules/hrms/api/useReports'
import { TableCard, HrAvatar, HrStatusPill } from '@/shared/components/hr'
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
        <p className="text-xs text-text-tertiary mb-3">Top 15 offenders by total minutes late</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 90, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#FFD68A" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} width={90} />
            <Tooltip
              contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #FFD68A', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#0F172A' }}
            />
            <Bar dataKey="Total Late (min)" fill="#FF9D00" />
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
              <th>Date</th>
              <th>Late (min)</th>
              <th>Check-in</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={`${r.employee_code}-${r.attendance_date}`}>
                <td><span className="hr-mono">{r.employee_code}</span></td>
                <td><HrAvatar name={r.employee_name} seed={i} /></td>
                <td>{r.department ?? '—'}</td>
                <td>{r.attendance_date}</td>
                <td><HrStatusPill tone="late">{r.late_by_minutes} min</HrStatusPill></td>
                <td>{r.check_in_at ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </ReportShell>
  )
}
