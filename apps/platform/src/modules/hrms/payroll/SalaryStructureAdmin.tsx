import React, { useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  IndianRupee, Wallet, TrendingDown, PiggyBank, Users, Search,
  ShieldCheck, FileText, Building2, History as HistoryIcon, X,
} from 'lucide-react'
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrButton, HrAvatar,
  type PillTone,
} from '@/shared/components/hr'
import {
  useEmployeeStructure,
  useStructureHistory,
  useSalaryComponents,
  type StructureLine,
  type ComponentCategory,
} from '../api/usePayroll'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { useCompanies } from '../api/useOrg'

const inr = (n: number) =>
  `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const fullName = (e: WorkforceEmployee) =>
  [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ')

const categoryTone = (c: ComponentCategory): PillTone =>
  c === 'DEDUCTION' ? 'red'
    : c === 'EARNING' ? 'ok'
      : c === 'REIMBURSEMENT' ? 'teal'
        : 'purple'

const categoryLabel = (c: ComponentCategory) => c.replace(/_/g, ' ')

const PIE_COLORS = ['#2563EB', '#22C55E', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4']

const EARNING_CATS: ComponentCategory[] = ['EARNING', 'REIMBURSEMENT']

export const SalaryStructureAdmin: React.FC = () => {
  const [companyId, setCompanyId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<WorkforceEmployee | null>(null)

  const companiesQ = useCompanies()

  // Directory drives the employee picker. We only fetch a page once the admin
  // has typed something or scoped a company, to avoid pulling the whole org.
  const directoryEnabled = search.trim().length > 0 || !!companyId
  const dirQ = useEmployeeDirectory(
    {
      companyId: companyId || undefined,
      search: search.trim() || undefined,
      pageSize: 25,
    },
    { enabled: directoryEnabled },
  )

  const employees = dirQ.data?.content ?? []

  const employeeId = selected?.id ?? ''
  const structureQ = useEmployeeStructure(employeeId)
  const historyQ = useStructureHistory(employeeId)
  const componentsQ = useSalaryComponents()

  const structure = structureQ.data ?? null
  const activeComponents = (componentsQ.data ?? []).filter((c) => c.isActive).length

  const { earnings, deductions, employer, grossMonthly, totalDeductions, netMonthly } = useMemo(() => {
    const lines = structure?.lines ?? []
    const earn = lines.filter((l) => EARNING_CATS.includes(l.category))
    const ded = lines.filter((l) => l.category === 'DEDUCTION')
    const emp = lines.filter((l) => l.category === 'EMPLOYER_CONTRIBUTION')
    const sum = (rows: StructureLine[]) => rows.reduce((t, r) => t + (r.monthlyAmount || 0), 0)
    const gross = sum(earn)
    const dedTotal = sum(ded)
    return {
      earnings: earn,
      deductions: ded,
      employer: emp,
      grossMonthly: gross,
      totalDeductions: dedTotal,
      netMonthly: gross - dedTotal,
    }
  }, [structure])

  const pieData = useMemo(
    () => earnings
      .filter((e) => e.monthlyAmount > 0)
      .map((e) => ({ name: e.componentName, value: e.monthlyAmount })),
    [earnings],
  )

  // Revision history → CTC trend (oldest → newest). History endpoint returns all
  // revisions; we sort by effective date so the line reads left-to-right.
  const trendData = useMemo(() => {
    const hist = historyQ.data ?? []
    return [...hist]
      .sort((a, b) => +new Date(a.effectiveFrom) - +new Date(b.effectiveFrom))
      .map((h) => ({
        label: format(new Date(h.effectiveFrom), 'MMM yy'),
        ctc: h.ctcAnnual,
      }))
  }, [historyQ.data])

  const renderEarningsTable = () => (
    <TableCard>
      <table className="hr-table">
        <thead>
          <tr>
            <th>Component</th>
            <th className="hidden sm:table-cell">Type</th>
            <th className="text-right">Monthly</th>
            <th className="hidden sm:table-cell text-right">Annual</th>
          </tr>
        </thead>
        <tbody>
          {earnings.map((r) => (
            <tr key={r.componentId}>
              <td className="font-medium text-text-primary">{r.componentName}</td>
              <td className="hidden sm:table-cell">
                <HrStatusPill tone={categoryTone(r.category)}>{categoryLabel(r.category)}</HrStatusPill>
              </td>
              <td className="hr-mono text-right">{inr(r.monthlyAmount)}</td>
              <td className="hidden sm:table-cell hr-mono text-right">{inr(r.monthlyAmount * 12)}</td>
            </tr>
          ))}
          {earnings.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-center text-text-tertiary">No earning components</td></tr>
          )}
        </tbody>
        {earnings.length > 0 && (
          <tfoot>
            <tr className="font-semibold">
              <td className="text-text-primary">Gross earnings</td>
              <td className="hidden sm:table-cell" />
              <td className="hr-mono text-right text-text-primary">{inr(grossMonthly)}</td>
              <td className="hidden sm:table-cell hr-mono text-right text-text-primary">{inr(grossMonthly * 12)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </TableCard>
  )

  const renderDeductionsTable = () => (
    <TableCard>
      <table className="hr-table">
        <thead>
          <tr>
            <th>Component</th>
            <th className="hidden sm:table-cell">Type</th>
            <th className="text-right">Monthly</th>
            <th className="hidden sm:table-cell text-right">Annual</th>
          </tr>
        </thead>
        <tbody>
          {deductions.map((r) => (
            <tr key={r.componentId}>
              <td className="font-medium text-text-primary">{r.componentName}</td>
              <td className="hidden sm:table-cell">
                <HrStatusPill tone={categoryTone(r.category)}>{categoryLabel(r.category)}</HrStatusPill>
              </td>
              <td className="hr-mono text-right">{inr(r.monthlyAmount)}</td>
              <td className="hidden sm:table-cell hr-mono text-right">{inr(r.monthlyAmount * 12)}</td>
            </tr>
          ))}
          {deductions.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-center text-text-tertiary">No deductions</td></tr>
          )}
        </tbody>
        {deductions.length > 0 && (
          <tfoot>
            <tr className="font-semibold">
              <td className="text-text-primary">Total deductions</td>
              <td className="hidden sm:table-cell" />
              <td className="hr-mono text-right text-[#B91C1C]">{inr(totalDeductions)}</td>
              <td className="hidden sm:table-cell hr-mono text-right text-[#B91C1C]">{inr(totalDeductions * 12)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </TableCard>
  )

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-8 space-y-6">
      <HrPageHeader
        crumb="Payroll"
        title="Salary Structure"
        subtitle="Review an employee's earnings, deductions and net pay breakdown."
        actions={
          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-text-tertiary" />
            <select
              value={companyId}
              onChange={(e) => { setCompanyId(e.target.value); setSelected(null) }}
              className="rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20"
            >
              <option value="">All companies</option>
              {(companiesQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        }
      />

      {/* Employee selector */}
      {!selected && (
        <TableCard
          search={{ value: search, onChange: setSearch, placeholder: 'Search employees by name, code or email…' }}
        >
          <table className="hr-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="hidden sm:table-cell">Code</th>
                <th className="hidden md:table-cell">Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {!directoryEnabled && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-text-tertiary">
                    <Search size={22} className="mx-auto mb-2 opacity-40" />
                    Search for an employee or pick a company to begin.
                  </td>
                </tr>
              )}
              {directoryEnabled && dirQ.isLoading && (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={4}><div className="h-8 w-full animate-pulse rounded bg-bg-base" /></td>
                  </tr>
                ))
              )}
              {directoryEnabled && !dirQ.isLoading && employees.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-text-tertiary">No employees match your search.</td>
                </tr>
              )}
              {directoryEnabled && !dirQ.isLoading && employees.map((e, i) => (
                <tr key={e.id}>
                  <td>
                    <HrAvatar name={fullName(e)} sub={e.email} seed={i} />
                  </td>
                  <td className="hidden sm:table-cell hr-mono">{e.employeeCode}</td>
                  <td className="hidden md:table-cell">
                    <HrStatusPill tone={e.employmentStatus === 'ACTIVE' ? 'ok' : 'gray'}>
                      {(e.employmentStatus ?? 'UNKNOWN').replace(/_/g, ' ')}
                    </HrStatusPill>
                  </td>
                  <td className="text-right">
                    <HrButton size="sm" variant="ghost" onClick={() => setSelected(e)}>View structure</HrButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      {/* Chosen employee */}
      {selected && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-white px-4 py-3 shadow-sm">
            <HrAvatar name={fullName(selected)} sub={`${selected.employeeCode} · ${selected.email}`} seed={1} />
            <HrButton size="sm" variant="ghost" onClick={() => setSelected(null)}>
              <X size={14} /> Change employee
            </HrButton>
          </div>

          {/* Loading */}
          {structureQ.isLoading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <HrStatCard icon={<IndianRupee size={18} />} color="orange" value="—" label="Annual CTC" loading />
              <HrStatCard icon={<Wallet size={18} />} color="green" value="—" label="Gross / mo" loading />
              <HrStatCard icon={<TrendingDown size={18} />} color="red" value="—" label="Deductions / mo" loading />
              <HrStatCard icon={<PiggyBank size={18} />} color="blue" value="—" label="Net pay / mo" loading />
            </div>
          )}

          {/* Error */}
          {structureQ.isError && (
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-6 text-center text-sm text-[#B91C1C]">
              Couldn't load this employee's salary structure. Please try again.
            </div>
          )}

          {/* Empty state */}
          {!structureQ.isLoading && !structureQ.isError && !structure && (
            <div className="rounded-xl border border-dashed border-border-default bg-white p-10 text-center">
              <FileText size={28} className="mx-auto mb-3 text-text-tertiary opacity-50" />
              <h3 className="text-base font-semibold text-text-primary">No salary structure</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
                {fullName(selected)} doesn't have a salary structure set up yet.
                {activeComponents > 0 && ` ${activeComponents} salary components are available in the catalog to build one.`}
              </p>
            </div>
          )}

          {/* Structure */}
          {!structureQ.isLoading && structure && (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <HrStatCard
                  icon={<IndianRupee size={18} />} color="orange"
                  value={inr(structure.ctcAnnual)} label="Annual CTC"
                  sub={`${inr(structure.ctcMonthly)} / month`}
                />
                <HrStatCard
                  icon={<Wallet size={18} />} color="green"
                  value={inr(grossMonthly)} label="Gross / mo"
                  sub={`${inr(grossMonthly * 12)} / yr`}
                />
                <HrStatCard
                  icon={<TrendingDown size={18} />} color="red"
                  value={inr(totalDeductions)} label="Deductions / mo"
                  sub={`${inr(totalDeductions * 12)} / yr`}
                />
                <HrStatCard
                  icon={<PiggyBank size={18} />} color="blue"
                  value={inr(netMonthly)} label="Net pay / mo"
                  sub={`${inr(netMonthly * 12)} / yr`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <HrStatusPill tone="info">Tax regime: {structure.taxRegime}</HrStatusPill>
                <HrStatusPill tone={structure.pfApplicable ? 'ok' : 'gray'}>
                  <ShieldCheck size={11} className="mr-1 inline" />
                  PF {structure.pfApplicable ? `· ${structure.pfStatus}` : 'not applicable'}
                </HrStatusPill>
                {structure.isCurrent && <HrStatusPill tone="green">Current</HrStatusPill>}
                <HrStatusPill tone="gray">
                  Effective {format(new Date(structure.effectiveFrom), 'd MMM yyyy')}
                </HrStatusPill>
                {structure.revisionNote && (
                  <span className="text-text-tertiary">· {structure.revisionNote}</span>
                )}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-text-primary">Earnings</h2>
                  {renderEarningsTable()}
                </div>
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-text-primary">Deductions</h2>
                  {renderDeductionsTable()}
                </div>
              </div>

              {employer.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-text-primary">Employer contributions</h2>
                  <TableCard>
                    <table className="hr-table">
                      <thead>
                        <tr>
                          <th>Component</th>
                          <th className="text-right">Monthly</th>
                          <th className="hidden sm:table-cell text-right">Annual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employer.map((r) => (
                          <tr key={r.componentId}>
                            <td className="font-medium text-text-primary">{r.componentName}</td>
                            <td className="hr-mono text-right">{inr(r.monthlyAmount)}</td>
                            <td className="hidden sm:table-cell hr-mono text-right">{inr(r.monthlyAmount * 12)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableCard>
                </div>
              )}

              {/* Charts */}
              <div className="grid gap-6 lg:grid-cols-2">
                {pieData.length > 0 && (
                  <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <Users size={15} className="text-text-tertiary" /> Earnings composition
                    </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData} dataKey="value" nameKey="name"
                            innerRadius={55} outerRadius={90} paddingAngle={2}
                          >
                            {pieData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => inr(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {pieData.map((d, i) => (
                        <span key={d.name} className="flex items-center gap-1.5 text-xs text-text-secondary">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {d.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {trendData.length > 1 && (
                  <div className="rounded-xl border border-border-default bg-white p-5 shadow-sm">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <HistoryIcon size={15} className="text-text-tertiary" /> CTC revision history
                    </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                          <YAxis
                            tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={70}
                            tickFormatter={(v: number) => inr(v)}
                          />
                          <Tooltip formatter={(v: number) => inr(v)} />
                          <Line type="monotone" dataKey="ctc" stroke="#FF9D00" strokeWidth={2.5} dot={{ r: 3, fill: '#FF9D00' }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>

              {/* History list (when more than the current revision exists) */}
              {(historyQ.data?.length ?? 0) > 1 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-text-primary">Revisions</h2>
                  <TableCard>
                    <table className="hr-table">
                      <thead>
                        <tr>
                          <th>Effective from</th>
                          <th className="text-right">Annual CTC</th>
                          <th className="hidden sm:table-cell">Regime</th>
                          <th className="hidden md:table-cell">Note</th>
                          <th className="text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...(historyQ.data ?? [])]
                          .sort((a, b) => +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom))
                          .map((h) => (
                            <tr key={h.id}>
                              <td className="text-text-primary">{format(new Date(h.effectiveFrom), 'd MMM yyyy')}</td>
                              <td className="hr-mono text-right">{inr(h.ctcAnnual)}</td>
                              <td className="hidden sm:table-cell">{h.taxRegime}</td>
                              <td className="hidden md:table-cell text-text-secondary">{h.revisionNote ?? '—'}</td>
                              <td className="text-right">
                                {h.isCurrent
                                  ? <HrStatusPill tone="green">Current</HrStatusPill>
                                  : <HrStatusPill tone="gray">Past</HrStatusPill>}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </TableCard>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
