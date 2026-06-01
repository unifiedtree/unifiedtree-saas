import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { DataTable } from '@unifiedtree/ui-kit'
import type { Column } from '@unifiedtree/ui-kit'
import { useHeadcountReport } from '@/modules/hrms/api/useReports'
import type { HeadcountRow } from '@/modules/hrms/api/useReports'
import { ReportShell, CompanySelector } from './ReportShell'

const TODAY = new Date().toISOString().slice(0, 10)

const COLUMNS: Column<HeadcountRow>[] = [
  { key: 'department', header: 'Department', cell: (r) => r.department ?? '(No dept)' },
  { key: 'total',      header: 'Total',      cell: (r) => r.total },
  { key: 'active',     header: 'Active',     cell: (r) => r.active },
  { key: 'on_notice',  header: 'On Notice',  cell: (r) => r.on_notice },
  { key: 'probation',  header: 'Probation',  cell: (r) => r.probation },
]

export function HeadcountReport() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('company') ?? ''
  const asOf      = params.get('asOf')    ?? TODAY

  const set = (key: string, val: string) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set(key, val); return n })

  const { data = [], isLoading, error, refetch } = useHeadcountReport(companyId || null, asOf)

  const chartData = data.map((r) => ({
    name: r.department ?? '—',
    Active: r.active,
    'On Notice': r.on_notice,
    Probation: r.probation,
  }))

  return (
    <ReportShell
      title="Headcount Report"
      description="Active, probation, and notice-period headcount by department"
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
            value={asOf}
            onChange={(e) => set('asOf', e.target.value)}
            className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 transition-all"
          />
        </>
      }
    >
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #334155)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Bar dataKey="Active"     stackId="a" fill="var(--color-accent-default, #6366f1)" />
            <Bar dataKey="On Notice"  stackId="a" fill="var(--color-status-warning-fg, #f59e0b)" />
            <Bar dataKey="Probation"  stackId="a" fill="var(--color-status-info-fg, #38bdf8)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <DataTable
        columns={COLUMNS}
        data={data}
        getRowKey={(r) => r.department ?? 'null'}
        emptyTitle="No headcount data"
        emptyDescription="No employees matched the selected filters."
      />
    </ReportShell>
  )
}
