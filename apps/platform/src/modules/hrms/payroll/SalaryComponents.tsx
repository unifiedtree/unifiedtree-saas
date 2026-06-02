import React, { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { DataTable, Badge, Button, EmptyState, type Column } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  useSalaryComponents, useSeedDefaultComponents, useDeleteComponent,
  type SalaryComponent, type ComponentCategory,
} from '../api/usePayroll'

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'EARNING', label: 'Earnings' },
  { key: 'DEDUCTION', label: 'Deductions' },
  { key: 'EMPLOYER_CONTRIBUTION', label: 'Employer' },
  { key: 'REIMBURSEMENT', label: 'Reimbursements' },
]

const catTone: Record<ComponentCategory, 'success' | 'error' | 'info' | 'default'> = {
  EARNING: 'success', DEDUCTION: 'error', EMPLOYER_CONTRIBUTION: 'info', REIMBURSEMENT: 'default',
}

export const SalaryComponents: React.FC = () => {
  const { toast } = useToast()
  const { data = [], isLoading } = useSalaryComponents()
  const seed = useSeedDefaultComponents()
  const del = useDeleteComponent()
  const [tab, setTab] = useState('all')

  const filtered = useMemo(
    () => tab === 'all' ? data : data.filter(c => c.category === tab),
    [data, tab])

  const columns: Column<SalaryComponent>[] = [
    { key: 'code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', header: 'Name', cell: (r) => r.name },
    { key: 'category', header: 'Category', cell: (r) => <Badge tone={catTone[r.category]}>{r.category.replace('_', ' ')}</Badge> },
    { key: 'statutory', header: 'Statutory', cell: (r) => r.isStatutory ? <Badge tone="warning">Statutory</Badge> : '—', hideBelow: 'sm' },
    { key: 'comp', header: 'Computation', cell: (r) => <span className="text-xs text-slate-500">{r.computationType}{r.percentValue ? ` (${r.percentValue}%)` : ''}</span>, hideBelow: 'md' },
    {
      key: 'actions', header: '', cell: (r) => (
        <Can code={P.PAYROLL_COMPONENTS_MANAGE}>
          {!r.isSystem && (
            <button onClick={() => del.mutate(r.id, { onSuccess: () => toast('Component deleted', 'success'), onError: (e) => toast((e as Error).message, 'error') })}
              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors">
              <Trash2 size={15} />
            </button>
          )}
        </Can>
      ),
    },
  ]

  return (
    <div className="max-w-5xl mx-auto p-6 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">Salary Components</h1>
          <p className="text-sm text-slate-500 mt-1">The catalog of earnings, deductions and statutory components.</p>
        </div>
      </div>

      {!isLoading && data.length === 0 ? (
        <EmptyState
          variant="first-run"
          title="No salary components"
          description="Seed the standard Indian payroll components to get started."
          primaryAction={{
            label: seed.isPending ? 'Seeding…' : 'Seed default components',
            onClick: () => seed.mutate(undefined, {
              onSuccess: (r) => toast(`Seeded ${r.componentCount} components`, 'success'),
              onError: (e) => toast((e as Error).message, 'error'),
            }),
          }}
        />
      ) : (
        <>
          <div className="flex gap-1 mb-4 border-b border-slate-200">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-[#0F6E56] text-[#0F6E56]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <DataTable columns={columns} data={filtered} getRowKey={(r) => r.id} isLoading={isLoading} emptyTitle="No components in this category" />
          </div>
        </>
      )}
    </div>
  )
}
