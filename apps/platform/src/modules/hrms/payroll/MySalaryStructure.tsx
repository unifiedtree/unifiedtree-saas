import React from 'react'
import { format } from 'date-fns'
import { IndianRupee, Wallet, ShieldCheck, TrendingDown, PiggyBank } from 'lucide-react'
import { EmptyState, CardSkeleton } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrStatCard, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { useMySalaryStructure, type StructureLine } from '../api/usePayroll'

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const categoryTone = (category: string): PillTone =>
  category === 'DEDUCTION' ? 'red' : category === 'EARNING' ? 'ok' : 'info'

export const MySalaryStructure: React.FC = () => {
  const { data, isLoading, error } = useMySalaryStructure()

  if (isLoading) return <div className="p-8"><CardSkeleton /></div>
  if (error) return <div className="p-8"><EmptyState variant="error" title="Couldn't load your salary" description="Please try again." /></div>
  if (!data) return (
    <div className="p-8">
      <EmptyState variant="first-run" title="No salary structure"
        description="Your salary structure has not been set up yet. Contact HR if you think this is a mistake." />
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-6">
      <HrPageHeader
        title="My Salary"
        crumb="Payroll"
        subtitle={`Effective from ${format(new Date(data.effectiveFrom), 'd MMM yyyy')}`}
      />

      {/* This page used to show CTC and tax regime and nothing else — an
          employee could not see what they actually take home. The server now
          returns a full-month gross / deductions / net breakdown, so show it:
          take-home is the number they came here for. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <HrStatCard icon={<IndianRupee size={18} />} color="orange" value={inr(data.ctcAnnual)} label="Annual CTC" sub={`${inr(data.ctcMonthly)} / month`} />
        <HrStatCard icon={<Wallet size={18} />} color="green" value={inr(data.grossMonthly ?? data.ctcMonthly)} label="Gross / mo" />
        <HrStatCard icon={<TrendingDown size={18} />} color="red" value={inr(data.totalDeductions ?? 0)} label="Deductions / mo" />
        <HrStatCard icon={<PiggyBank size={18} />} color="blue" value={inr(data.netMonthly ?? data.ctcMonthly)} label="Take-home / mo" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <HrStatusPill tone="info">Tax regime: {data.taxRegime}</HrStatusPill>
        <HrStatusPill tone={data.pfApplicable ? 'ok' : 'gray'}>
          <ShieldCheck size={11} className="mr-1 inline" />
          PF {data.pfApplicable ? `· ${data.pfStatus}` : 'not applicable'}
        </HrStatusPill>
      </div>

      <BreakdownTable title="Earnings" rows={data.earnings ?? data.lines} total={data.grossMonthly} />
      <BreakdownTable title="Deductions" rows={data.deductions ?? []} total={data.totalDeductions} />

      <p className="text-xs text-text-tertiary">
        Full-month figures. Your actual payslip is pro-rated by paid days, so a
        month with unpaid leave will pay less. Contact HR if something looks wrong.
      </p>
    </div>
  )
}

function BreakdownTable({ title, rows, total }: { title: string; rows: StructureLine[]; total?: number }) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Component</th>
              <th className="hidden sm:table-cell">Type</th>
              <th>Monthly</th>
              <th className="hidden sm:table-cell">Annual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              // componentId is null on server-computed statutory lines, so key
              // on the code, which is unique within a breakdown.
              <tr key={r.componentCode}>
                <td className="text-text-primary font-medium">{r.componentName}</td>
                <td className="hidden sm:table-cell">
                  <HrStatusPill tone={categoryTone(r.category)}>{r.category.replace('_', ' ')}</HrStatusPill>
                </td>
                <td className="hr-mono">{inr(r.monthlyAmount)}</td>
                <td className="hidden sm:table-cell hr-mono">{inr(r.monthlyAmount * 12)}</td>
              </tr>
            ))}
            {total != null && (
              <tr className="font-semibold">
                <td className="text-text-primary">Total</td>
                <td className="hidden sm:table-cell" />
                <td className="hr-mono">{inr(total)}</td>
                <td className="hidden sm:table-cell hr-mono">{inr(total * 12)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
