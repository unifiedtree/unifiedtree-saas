import React from 'react'
import { format } from 'date-fns'
import { IndianRupee, Wallet, ShieldCheck } from 'lucide-react'
import { EmptyState, CardSkeleton } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrStatCard, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { useMySalaryStructure } from '../api/usePayroll'

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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <HrStatCard icon={<IndianRupee size={18} />} color="orange" value={inr(data.ctcAnnual)} label="Annual CTC" />
        <HrStatCard icon={<Wallet size={18} />} color="green" value={inr(data.ctcMonthly)} label="Monthly" />
        <HrStatCard icon={<ShieldCheck size={18} />} color="blue" value={data.taxRegime} label="Tax regime" />
      </div>

      {data.lines.length > 0 && (
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
              {data.lines.map((r) => (
                <tr key={r.componentId}>
                  <td className="text-text-primary font-medium">{r.componentName}</td>
                  <td className="hidden sm:table-cell">
                    <HrStatusPill tone={categoryTone(r.category)}>{r.category.replace('_', ' ')}</HrStatusPill>
                  </td>
                  <td className="hr-mono">{inr(r.monthlyAmount)}</td>
                  <td className="hidden sm:table-cell hr-mono">{inr(r.monthlyAmount * 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  )
}
