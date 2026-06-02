import React from 'react'
import { format } from 'date-fns'
import { Badge, EmptyState, CardSkeleton, DataTable, type Column } from '@unifiedtree/ui-kit'
import { useMySalaryStructure, type StructureLine } from '../api/usePayroll'

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const lineColumns: Column<StructureLine>[] = [
  { key: 'name', header: 'Component', cell: (r) => r.componentName },
  { key: 'category', header: 'Type', cell: (r) => <Badge tone={r.category === 'DEDUCTION' ? 'error' : r.category === 'EARNING' ? 'success' : 'info'}>{r.category.replace('_', ' ')}</Badge>, hideBelow: 'sm' },
  { key: 'monthly', header: 'Monthly', cell: (r) => inr(r.monthlyAmount) },
  { key: 'annual', header: 'Annual', cell: (r) => inr(r.monthlyAmount * 12), hideBelow: 'sm' },
]

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
      <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">My Salary</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Annual CTC</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{inr(data.ctcAnnual)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Monthly</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{inr(data.ctcMonthly)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Tax regime</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{data.taxRegime}</p>
        </div>
      </div>
      <p className="text-xs text-slate-400">Effective from {format(new Date(data.effectiveFrom), 'd MMM yyyy')}</p>

      {data.lines.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <DataTable columns={lineColumns} data={data.lines} getRowKey={(r) => r.componentId} />
        </div>
      )}
    </div>
  )
}
