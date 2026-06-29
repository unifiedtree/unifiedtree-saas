import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useHeadcountReport } from '@/modules/hrms/api/useReports'
import { ReportShell, CompanySelector } from './ReportShell'
import { TableCard } from '@/shared/components/hr'

const TODAY = new Date().toISOString().slice(0, 10)

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
            className="bg-white border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/20 transition-all"
          />
        </>
      }
    >
      <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} />
            <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid var(--color-border-default, #FFD68A)', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              labelStyle={{ color: '#111827', fontWeight: 600 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#6B7280' }} />
            <Bar dataKey="Active"     stackId="a" fill="#10B981" />
            <Bar dataKey="On Notice"  stackId="a" fill="#F59E0B" />
            <Bar dataKey="Probation"  stackId="a" fill="#2563EB" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Department</th>
              <th>Total</th>
              <th>Active</th>
              <th>On Notice</th>
              <th>Probation</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.department ?? 'null'}>
                <td className="font-medium text-text-primary">{r.department ?? '(No dept)'}</td>
                <td>{r.total}</td>
                <td>{r.active}</td>
                <td>{r.on_notice}</td>
                <td>{r.probation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </ReportShell>
  )
}
