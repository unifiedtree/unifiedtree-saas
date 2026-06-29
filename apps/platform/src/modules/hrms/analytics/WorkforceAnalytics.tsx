import React, { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart, Bar,
  PieChart, Pie, Cell,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { Users, UserCheck, TrendingDown, Building2 } from 'lucide-react'
import { format, subMonths } from 'date-fns'
import {
  useHeadcountReport,
  useDiversityReport,
  useAttritionReport,
} from '@/modules/hrms/api/useReports'
import { useEmployeeDirectory } from '@/modules/hrms/api/useWorkforce'
import { useCompanies } from '@/modules/hrms/api/useOrg'
import {
  HrPageHeader,
  HrStatCard,
  HrStatusPill,
  TableCard,
} from '@/shared/components/hr'

const CHART = {
  blue: '#2563EB',
  green: '#22C55E',
  amber: '#F59E0B',
  purple: '#8B5CF6',
  red: '#EF4444',
  cyan: '#06B6D4',
}
const DONUT_COLORS = [CHART.blue, '#EC4899', CHART.amber, CHART.purple, CHART.cyan, CHART.green]

const GENDER_LABEL: Record<string, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
}

const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  border: '1px solid var(--color-border-default, #FFD68A)',
  borderRadius: 8,
  fontSize: 12,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
}

export const WorkforceAnalytics: React.FC = () => {
  // ── Company picker (defaults to first company once loaded) ──────────────────
  const { data: companies = [], isLoading: loadingCompanies } = useCompanies()
  const [companyId, setCompanyId] = useState<string>('')
  const activeCompanyId = companyId || companies[0]?.id || ''

  // ── Date window: trailing 12 months for attrition ───────────────────────────
  const today = useMemo(() => new Date(), [])
  const from = useMemo(() => format(subMonths(today, 11), 'yyyy-MM-dd'), [today])
  const to = useMemo(() => format(today, 'yyyy-MM-dd'), [today])
  const asOf = to

  // ── Data hooks (all gated on a real companyId) ──────────────────────────────
  const headcount = useHeadcountReport(activeCompanyId || null, asOf)
  const diversity = useDiversityReport(activeCompanyId || null)
  const attrition = useAttritionReport(activeCompanyId || null, from, to)
  const directory = useEmployeeDirectory(
    { companyId: activeCompanyId, page: 0, pageSize: 1 },
    { enabled: !!activeCompanyId },
  )

  const headcountRows = headcount.data ?? []
  const diversityRows = diversity.data ?? []
  const attritionRows = attrition.data ?? []

  // ── Derived KPIs (everything from real report rows) ─────────────────────────
  const totals = useMemo(() => {
    const total = headcountRows.reduce((s, r) => s + (r.total ?? 0), 0)
    const active = headcountRows.reduce((s, r) => s + (r.active ?? 0), 0)
    const onNotice = headcountRows.reduce((s, r) => s + (r.on_notice ?? 0), 0)
    const probation = headcountRows.reduce((s, r) => s + (r.probation ?? 0), 0)
    return { total, active, onNotice, probation }
  }, [headcountRows])

  // Latest month's attrition % from the trailing window.
  const latestAttritionPct = useMemo(() => {
    if (attritionRows.length === 0) return null
    return attritionRows[attritionRows.length - 1].attrition_pct
  }, [attritionRows])

  const totalExits = useMemo(
    () => attritionRows.reduce((s, r) => s + (r.exits ?? 0), 0),
    [attritionRows],
  )

  const directoryTotal = directory.data?.totalElements ?? null

  // ── Chart datasets ──────────────────────────────────────────────────────────
  const deptBarData = useMemo(
    () =>
      headcountRows
        .map((r) => ({
          name: r.department ?? '(No dept)',
          Total: r.total ?? 0,
          Active: r.active ?? 0,
        }))
        .sort((a, b) => b.Total - a.Total),
    [headcountRows],
  )

  // Aggregate diversity rows (which are per department+gender) to company-wide gender split.
  const genderData = useMemo(() => {
    const byGender = new Map<string, number>()
    for (const r of diversityRows) {
      const key = r.gender || 'PREFER_NOT_TO_SAY'
      byGender.set(key, (byGender.get(key) ?? 0) + (r.count ?? 0))
    }
    return Array.from(byGender.entries())
      .map(([gender, count]) => ({ name: GENDER_LABEL[gender] ?? gender, value: count }))
      .sort((a, b) => b.value - a.value)
  }, [diversityRows])

  const genderTotal = useMemo(() => genderData.reduce((s, g) => s + g.value, 0), [genderData])

  const attritionLineData = useMemo(
    () =>
      attritionRows.map((r) => ({
        name: r.month,
        'Attrition %': r.attrition_pct,
        Exits: r.exits,
      })),
    [attritionRows],
  )

  const isLoading =
    loadingCompanies || headcount.isLoading || diversity.isLoading || attrition.isLoading

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Reports & Analytics"
        title="Workforce Analytics"
        subtitle="Headcount, diversity, and attrition across your organization"
        actions={
          <select
            value={activeCompanyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={loadingCompanies || companies.length === 0}
            className="rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20 disabled:opacity-50"
          >
            {companies.length === 0 && <option value="">No companies</option>}
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        }
      />

      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HrStatCard
          icon={<Users size={18} />}
          color="blue"
          value={totals.total.toLocaleString()}
          label="Total Headcount"
          sub={
            directoryTotal != null
              ? `${directoryTotal.toLocaleString()} in directory`
              : `${headcountRows.length} departments`
          }
          loading={headcount.isLoading}
        />
        <HrStatCard
          icon={<UserCheck size={18} />}
          color="green"
          value={totals.active.toLocaleString()}
          label="Active Employees"
          sub={
            totals.total > 0
              ? `${Math.round((totals.active / totals.total) * 100)}% of headcount`
              : undefined
          }
          loading={headcount.isLoading}
        />
        <HrStatCard
          icon={<TrendingDown size={18} />}
          color="red"
          value={latestAttritionPct != null ? `${latestAttritionPct}%` : '—'}
          label="Attrition (latest month)"
          sub={`${totalExits.toLocaleString()} exits · trailing 12 mo`}
          loading={attrition.isLoading}
        />
        <HrStatCard
          icon={<Building2 size={18} />}
          color="orange"
          value={(totals.onNotice + totals.probation).toLocaleString()}
          label="On Notice / Probation"
          sub={`${totals.onNotice} notice · ${totals.probation} probation`}
          loading={headcount.isLoading}
        />
      </div>

      {/* ── Charts row: dept bar + gender donut ─────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Headcount by Department</h2>
            <HrStatusPill tone="blue">{headcountRows.length} depts</HrStatusPill>
          </div>
          {headcount.isLoading ? (
            <div className="h-[280px] animate-pulse rounded-lg bg-bg-base" />
          ) : deptBarData.length === 0 ? (
            <EmptyChart label="No headcount data for this company" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={deptBarData} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} interval={0} angle={-12} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#111827', fontWeight: 600 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6B7280' }} />
                <Bar dataKey="Active" fill={CHART.green} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Total" fill={CHART.blue} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Gender Diversity</h2>
            <HrStatusPill tone="purple">{genderTotal.toLocaleString()} people</HrStatusPill>
          </div>
          {diversity.isLoading ? (
            <div className="h-[280px] animate-pulse rounded-lg bg-bg-base" />
          ) : genderData.length === 0 ? (
            <EmptyChart label="No diversity data" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={genderData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={2}
                >
                  {genderData.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6B7280' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Attrition line ──────────────────────────────────────────────────── */}
      <div className="mt-5 rounded-xl border border-border-default bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Monthly Attrition</h2>
          <span className="text-xs text-text-tertiary">
            {format(subMonths(today, 11), 'MMM yyyy')} – {format(today, 'MMM yyyy')}
          </span>
        </div>
        {attrition.isLoading ? (
          <div className="h-[260px] animate-pulse rounded-lg bg-bg-base" />
        ) : attritionLineData.length === 0 ? (
          <EmptyChart label="No attrition data in this window" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={attritionLineData} margin={{ top: 4, right: 24, left: -10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#111827', fontWeight: 600 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#6B7280' }} />
              <Line type="monotone" dataKey="Attrition %" stroke="#FF9D00" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Department headcount table ──────────────────────────────────────── */}
      <div className="mt-5">
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Total</th>
                <th>Active</th>
                <th>On Notice</th>
                <th>Probation</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {headcount.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j}>
                        <div className="h-4 w-16 animate-pulse rounded bg-bg-base" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : headcountRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-text-tertiary">
                    No department headcount to display.
                  </td>
                </tr>
              ) : (
                deptBarData.map((row) => {
                  const src = headcountRows.find((r) => (r.department ?? '(No dept)') === row.name)!
                  const share = totals.total > 0 ? Math.round((src.total / totals.total) * 100) : 0
                  return (
                    <tr key={row.name}>
                      <td className="font-medium text-text-primary">{row.name}</td>
                      <td>{src.total}</td>
                      <td>{src.active}</td>
                      <td>
                        {src.on_notice > 0 ? (
                          <HrStatusPill tone="orange">{src.on_notice}</HrStatusPill>
                        ) : (
                          <span className="text-text-tertiary">0</span>
                        )}
                      </td>
                      <td>
                        {src.probation > 0 ? (
                          <HrStatusPill tone="info">{src.probation}</HrStatusPill>
                        ) : (
                          <span className="text-text-tertiary">0</span>
                        )}
                      </td>
                      <td className="text-text-secondary">{share}%</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </TableCard>
      </div>

      {!isLoading && !activeCompanyId && (
        <p className="mt-6 text-center text-sm text-text-tertiary">
          Select a company to view workforce analytics.
        </p>
      )}
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-default text-text-tertiary">
      <Building2 size={22} className="opacity-50" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
