import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts'
import { useAttritionReport } from '@/modules/hrms/api/useReports'
import { TableCard } from '@/shared/components/hr'
import { ReportShell, CompanySelector } from './ReportShell'

function defaultFrom() {
  const d = new Date()
  d.setMonth(d.getMonth() - 11)
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

export function AttritionReport() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('company') ?? ''
  const from      = params.get('from')    ?? defaultFrom()
  const to        = params.get('to')      ?? new Date().toISOString().slice(0, 10)

  const set = (key: string, val: string) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set(key, val); return n })

  const { data = [], isLoading, error, refetch } = useAttritionReport(companyId || null, from, to)

  const chartData = data.map((r) => ({
    name: r.month,
    Exits: r.exits,
    Resignations: r.resignations,
    Terminations: r.terminations,
    'Attrition %': r.attrition_pct,
  }))

  return (
    <ReportShell
      title="Attrition Report"
      description="Monthly exits, resignations, terminations, and attrition rate"
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
            className="bg-white border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-secondary focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/20 transition-all"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => set('to', e.target.value)}
            className="bg-white border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-secondary focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/20 transition-all"
          />
        </>
      }
    >
      <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 24, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #E2E8F0)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} />
            <YAxis yAxisId="left"  tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} unit="%" />
            <Tooltip
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid var(--color-border-default, #E2E8F0)', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              labelStyle={{ color: 'var(--color-text-primary, #0F172A)' }}
              itemStyle={{ color: 'var(--color-text-secondary, #334155)' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-text-tertiary, #64748B)' }} />
            <Bar yAxisId="left" dataKey="Resignations" stackId="a" fill="#F59E0B" />
            <Bar yAxisId="left" dataKey="Terminations" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="Attrition %" stroke="#FF9D00" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Exits</th>
              <th>Resignations</th>
              <th>Terminations</th>
              <th>Attrition %</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.month}>
                <td>{r.month}</td>
                <td>{r.exits}</td>
                <td>{r.resignations}</td>
                <td>{r.terminations}</td>
                <td>{r.attrition_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </ReportShell>
  )
}
