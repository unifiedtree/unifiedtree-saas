import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useDiversityReport } from '@/modules/hrms/api/useReports'
import type { DiversityRow } from '@/modules/hrms/api/useReports'
import { ReportShell, CompanySelector } from './ReportShell'
import { TableCard, HrStatusPill } from '@/shared/components/hr'

const GENDER_COLORS: Record<string, string> = {
  MALE:   '#4096FF',
  FEMALE: '#EC4899',
  OTHER:  '#14B8A6',
}
const FALLBACK_COLORS = ['#FF9D00', '#4096FF', '#EC4899', '#14B8A6', '#22C55E']

const GENDER_TONES: Record<string, 'blue' | 'pink' | 'teal' | 'gray'> = {
  MALE:   'blue',
  FEMALE: 'pink',
  OTHER:  'teal',
}

const chartTooltipStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #FFD68A',
  borderRadius: 8,
  fontSize: 12,
  color: '#0F172A',
} as const

// Aggregate total by gender for pie chart
function genderTotals(rows: DiversityRow[]) {
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.gender, (map.get(r.gender) ?? 0) + r.count)
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }))
}

// Unique departments with per-gender counts for stacked bar
function deptGenderData(rows: DiversityRow[]) {
  const depts = [...new Set(rows.map((r) => r.department ?? '—'))]
  const genders = [...new Set(rows.map((r) => r.gender))]
  return depts.map((dept) => {
    const entry: Record<string, unknown> = { name: dept }
    for (const g of genders) {
      const row = rows.find((r) => (r.department ?? '—') === dept && r.gender === g)
      entry[g] = row?.count ?? 0
    }
    return entry
  })
}

export function DiversityReport() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('company') ?? ''

  const set = (key: string, val: string) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set(key, val); return n })

  const { data = [], isLoading, error, refetch } = useDiversityReport(companyId || null)

  const pieData  = genderTotals(data)
  const barData  = deptGenderData(data)
  const genders  = [...new Set(data.map((r) => r.gender))]

  return (
    <ReportShell
      title="Diversity Report"
      description="Headcount breakdown by gender and department for the active workforce"
      companyId={companyId || null}
      isLoading={isLoading}
      error={error}
      hasData={data.length > 0}
      onRetry={refetch}
      filters={
        <CompanySelector value={companyId} onChange={(v) => set('company', v)} />
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie — overall gender split */}
        <div className="rounded-2xl border border-border-default bg-white p-5">
          <p className="text-xs text-text-secondary mb-3">Overall gender breakdown</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {pieData.map((entry, index) => (
                  <Cell
                    key={entry.name}
                    fill={GENDER_COLORS[entry.name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip contentStyle={chartTooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Stacked bar — dept × gender */}
        <div className="rounded-2xl border border-border-default bg-white p-5">
          <p className="text-xs text-text-secondary mb-3">By department</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default, #FFD68A)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary, #94a3b8)' }} interval={0} angle={-30} textAnchor="end" height={45} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary, #94a3b8)' }} allowDecimals={false} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={{ color: '#0F172A' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#64748B' }} />
              {genders.map((g, i) => (
                <Bar
                  key={g}
                  dataKey={g}
                  stackId="a"
                  fill={GENDER_COLORS[g] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]}
                  radius={i === genders.length - 1 ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-text-primary">No diversity data</p>
          <p className="mt-1 text-sm text-text-secondary">No employee gender data available for this company.</p>
        </div>
      ) : (
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Gender</th>
                <th>Count</th>
                <th>% of Dept</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={`${r.department ?? 'null'}-${r.gender}`}>
                  <td className="text-text-primary">{r.department ?? '—'}</td>
                  <td>
                    <HrStatusPill tone={GENDER_TONES[r.gender] ?? 'gray'}>{r.gender}</HrStatusPill>
                  </td>
                  <td className="text-text-primary">{r.count}</td>
                  <td className="text-text-secondary">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </ReportShell>
  )
}
