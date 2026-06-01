import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts'
import { DataTable } from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { useAttritionReport } from '@/modules/hrms/api/useReports'
import type { AttritionRow } from '@/modules/hrms/api/useReports'
import { ReportShell, CompanySelector } from './ReportShell'

function defaultFrom() {
  const d = new Date()
  d.setMonth(d.getMonth() - 11)
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

const COLUMNS: Column<AttritionRow>[] = [
  { key: 'month',         header: 'Month',         cell: (r) => r.month },
  { key: 'exits',         header: 'Exits',         cell: (r) => r.exits },
  { key: 'resignations',  header: 'Resignations',  cell: (r) => r.resignations },
  { key: 'terminations',  header: 'Terminations',  cell: (r) => r.terminations },
  { key: 'attrition_pct', header: 'Attrition %',   cell: (r) => `${r.attrition_pct}%` },
]

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
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 24, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #334155)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} />
            <YAxis yAxisId="left"  tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} unit="%" />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Bar yAxisId="left" dataKey="Resignations" stackId="a" fill="var(--color-status-warning-fg, #f59e0b)" />
            <Bar yAxisId="left" dataKey="Terminations" stackId="a" fill="var(--color-status-danger-fg, #ef4444)" radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="Attrition %" stroke="var(--color-accent-default, #6366f1)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <DataTable
        columns={COLUMNS}
        data={data}
        getRowKey={(r) => r.month}
        emptyTitle="No attrition data"
        emptyDescription="No exits found in the selected date range."
      />
    </ReportShell>
  )
}
