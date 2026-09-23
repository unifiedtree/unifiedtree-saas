import React, { useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  IndianRupee, Wallet, TrendingDown, PiggyBank, Users, Search,
  ShieldCheck, FileText, Building2, History as HistoryIcon, X, ArrowRight, Calculator, Download, Edit,
} from 'lucide-react'
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { DataTable } from '@/shared/components/DataTable'
import {
  HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrButton, HrAvatar, HrTabs, HrTabPanel,
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


function SalaryStructureOverviewMock() {
  return (
    <div className="space-y-4">
      <TableCard>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border-default)] bg-[var(--bg-base)] text-xs text-gray-500">
            <tr>
              <th className="p-4 font-medium">Employee</th>
              <th className="p-4 font-medium">Basic Pay</th>
              <th className="p-4 font-medium">HRA</th>
              <th className="p-4 font-medium">Special Allowance</th>
              <th className="p-4 font-medium">Deductions</th>
              <th className="p-4 font-medium">Net Payable</th>
              <th className="p-4 font-medium text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--border-default)]">
              <td className="p-4">
                <div className="flex items-center gap-2">
                  <HrAvatar name="Rajesh Kumar" sub="RK" seed={1} />
                </div>
              </td>
              <td className="p-4">₹ 40,000</td>
              <td className="p-4">₹ 20,000</td>
              <td className="p-4">₹ 10,000</td>
              <td className="p-4">₹ 2,400 (PF)</td>
              <td className="p-4"><span className="font-bold text-green-600">₹ 67,600</span></td>
              <td className="p-4 text-center">
                <button className="text-gray-400 hover:text-gray-600"><Edit size={16} /></button>
              </td>
            </tr>
            <tr className="border-b border-[var(--border-default)]">
              <td className="p-4">
                <div className="flex items-center gap-2">
                  <HrAvatar name="Priya Mehta" sub="PM" seed={2} />
                </div>
              </td>
              <td className="p-4">₹ 60,000</td>
              <td className="p-4">₹ 30,000</td>
              <td className="p-4">₹ 15,000</td>
              <td className="p-4">₹ 3,600 (PF)</td>
              <td className="p-4"><span className="font-bold text-green-600">₹ 1,01,400</span></td>
              <td className="p-4 text-center">
                <button className="text-gray-400 hover:text-gray-600"><Edit size={16} /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}

export const SalaryStructureAdmin: React.FC = () => {
  const [companyId, setCompanyId] = useState<string>('')
  
  const [tab, setTab] = useState<'overview' | 'detail'>('overview')
  const tabs = [
    { key: 'overview', label: 'All Employees Overview' },
    { key: 'detail', label: 'Employee Details' }
  ]

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

  // 2026-09-10: this block used to sum `structure.lines` client-side and showed
  // ₹0 gross / ₹0 deductions / ₹0 net for essentially every employee — a
  // freshly onboarded person has no component rows, and statutory deductions
  // (PF/ESI/PT) are never structure rows at all, the payroll engine generates
  // them at run time. The payroll run screen showed real gross and net for the
  // same person, which is the contradiction the client reported.
  //
  // The server now runs the real engine over a full month and returns the
  // breakdown. We prefer those fields and keep the old local math purely as a
  // fallback for a backend rev that predates them.
  const { earnings, deductions, employer, grossMonthly, totalDeductions, netMonthly } = useMemo(() => {
    const lines = structure?.lines ?? []
    const sum = (rows: StructureLine[]) => rows.reduce((t, r) => t + (r.monthlyAmount || 0), 0)
    if (structure?.earnings) {
      const ded = structure.deductions ?? []
      return {
        earnings: structure.earnings,
        deductions: ded,
        employer: structure.employerContributions ?? [],
        grossMonthly: structure.grossMonthly ?? sum(structure.earnings),
        totalDeductions: structure.totalDeductions ?? sum(ded),
        netMonthly: structure.netMonthly ?? (sum(structure.earnings) - sum(ded)),
      }
    }
    const earn = lines.filter((l) => EARNING_CATS.includes(l.category))
    const ded = lines.filter((l) => l.category === 'DEDUCTION')
    const gross = sum(earn)
    const dedTotal = sum(ded)
    return {
      earnings: earn,
      deductions: ded,
      employer: lines.filter((l) => l.category === 'EMPLOYER_CONTRIBUTION'),
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

  // Earnings. Bound to `earnings` — the DataTable migration left this helper
  // rendering the EMPLOYEE DIRECTORY, so the panel headed "Earnings" listed
  // staff while the computed earnings were discarded. Totals are not repeated
  // here: the stat strip above already shows Gross / Deductions / Net.
  const renderEarningsTable = () => (
    <TableCard>
      <DataTable
        columns={[
          { key: 'component', header: 'Component', render: (r: any) => <span className="font-medium text-text-primary">{r.componentName}</span> },
          { key: 'type', header: 'Type', render: (r: any) => <HrStatusPill tone={categoryTone(r.category)}>{categoryLabel(r.category)}</HrStatusPill> },
          { key: 'monthly', header: 'Monthly', render: (r: any) => <span className="hr-mono text-right">{inr(r.monthlyAmount)}</span> },
          { key: 'annual', header: 'Annual', render: (r: any) => <span className="hr-mono text-right">{inr(r.monthlyAmount * 12)}</span> },
        ]}
        data={earnings}
        keyField="componentId"
        emptyMessage="No earning components"
      />
    </TableCard>
  )

  // Deductions. Bound to `deductions` — this helper was rendering EMPLOYER
  // CONTRIBUTIONS, which are a different axis and are already shown in their
  // own block below.
  const renderDeductionsTable = () => (
    <TableCard>
      <DataTable
        columns={[
          { key: 'component', header: 'Component', render: (r: any) => <span className="font-medium text-text-primary">{r.componentName}</span> },
          { key: 'type', header: 'Type', render: (r: any) => <HrStatusPill tone={categoryTone(r.category)}>{categoryLabel(r.category)}</HrStatusPill> },
          { key: 'monthly', header: 'Monthly', render: (r: any) => <span className="hr-mono text-right">{inr(r.monthlyAmount)}</span> },
          { key: 'annual', header: 'Annual', render: (r: any) => <span className="hr-mono text-right">{inr(r.monthlyAmount * 12)}</span> },
        ]}
        data={deductions}
        keyField="componentId"
        emptyMessage="No deductions"
      />
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
            <HrButton variant="ghost"><Calculator size={15} className="mr-1" /> Bulk Revise CTC</HrButton>
            <Building2 size={15} className="text-text-tertiary ml-2" />
            <select
              value={companyId}
              onChange={(e) => { setCompanyId(e.target.value); setSelected(null) }}
              className="rounded-lg border border-border-default bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
            >
              <option value="">All companies</option>
              {(companiesQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        }
      />

      
      <HrTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as any)} />

      <div className="mt-6">
        {tab === 'overview' && (
          <HrTabPanel tabKey="overview">
            <SalaryStructureOverviewMock />
          </HrTabPanel>
        )}
        {tab === 'detail' && (
          <HrTabPanel tabKey="detail">
      {/* Employee selector */}
      {!selected && (
        <TableCard
          search={{ value: search, onChange: setSearch, placeholder: 'Search employees by name, code or email…' }}
        >
          {/* The employee picker. This slot was bound to the STRUCTURE REVISION
              HISTORY of whoever happened to be selected — which, on a screen
              shown only when nobody is selected, meant an empty table and no
              way to choose an employee at all. `setSelected` was unreachable,
              so the page could not be used. */}
          <DataTable
            columns={[
              { key: 'employee', header: 'Employee', render: (r: any) => (
                <div className="flex items-center gap-3">
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-700">
                      {(r.firstName?.[0] ?? '')}{(r.lastName?.[0] ?? '')}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{r.firstName} {r.lastName}</p>
                    <p className="text-xs text-text-tertiary">{r.designationName ?? 'No designation'}</p>
                  </div>
                </div>
              ) },
              { key: 'code', header: 'Code', render: (r: any) => <span className="hr-mono text-text-secondary">{r.employeeCode}</span> },
              { key: 'status', header: 'Status', render: (r: any) => <HrStatusPill tone={r.employmentStatus === 'ACTIVE' ? 'ok' : 'gray'}>{r.employmentStatus ?? '—'}</HrStatusPill> },
              { key: 'action', header: 'Action', render: (r: any) => (
                <div className="w-full text-right">
                  <HrButton size="sm" variant="ghost" onClick={() => setSelected(r)}>
                    Select <ArrowRight size={14} className="ml-1 inline-block" />
                  </HrButton>
                </div>
              ) },
            ]}
            data={directoryEnabled ? (dirQ.data?.content ?? []) : []}
            keyField="id"
            loading={directoryEnabled && dirQ.isLoading}
            emptyMessage={!directoryEnabled ? 'Search for an employee or pick a company to begin.' : 'No employees found.'}
          />
        </TableCard>
      )}

      {/* Chosen employee */}
      {selected && (
        <div className="space-y-6">
          <div className="ut-card ut-card-sm flex flex-wrap items-center justify-between gap-3 px-4 py-3">
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

              {/* Be explicit about where the numbers came from. When nobody has
                  configured components, payroll pays the whole CTC as BASIC and
                  we preview exactly that — but the admin should know it is a
                  derived breakup, not one somebody set up. */}
              <div className="text-xs text-text-tertiary">
                {structure.derivedFromCtc
                  ? 'No salary components configured — this breakup is derived from CTC as a single Basic component, the same fallback payroll applies. Use “Revise structure” on the employee’s profile to define your own.'
                  : 'Full-month figures. An actual payroll run pro-rates earnings by paid days, so a month with LOP will pay less.'}
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

              {/* Charts — column count follows what renders so a lone chart
                  spans full width instead of stranding beside a dead cell */}
              <div className={pieData.length > 0 && trendData.length > 1 ? 'grid gap-6 lg:grid-cols-2' : 'grid gap-6'}>
                {pieData.length > 0 && (
                  <div className="ut-card p-5">
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
                  <div className="ut-card p-5">
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
                          <Line type="monotone" dataKey="ctc" stroke="#059669" strokeWidth={2.5} dot={{ r: 3, fill: '#059669' }} />
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
          </HrTabPanel>
        )}
      </div>
    </div>
  )
}