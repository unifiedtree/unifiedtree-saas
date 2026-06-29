import React, { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { EmptyState } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import {
  useSalaryComponents, useSeedDefaultComponents, useCreateComponent, useUpdateComponent, useDeleteComponent,
  type SalaryComponent, type ComponentCategory,
} from '../api/usePayroll'

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'EARNING', label: 'Earnings' },
  { key: 'DEDUCTION', label: 'Deductions' },
  { key: 'EMPLOYER_CONTRIBUTION', label: 'Employer' },
  { key: 'REIMBURSEMENT', label: 'Reimbursements' },
]

const CATEGORIES: { value: ComponentCategory; label: string }[] = [
  { value: 'EARNING', label: 'Earning' },
  { value: 'DEDUCTION', label: 'Deduction' },
  { value: 'EMPLOYER_CONTRIBUTION', label: 'Employer Contribution' },
  { value: 'REIMBURSEMENT', label: 'Reimbursement' },
]

const COMPUTATION_TYPES = ['FIXED', 'PERCENT_OF_BASIC', 'FORMULA', 'STATUTORY']

const catTone: Record<ComponentCategory, PillTone> = {
  EARNING: 'ok', DEDUCTION: 'red', EMPLOYER_CONTRIBUTION: 'info', REIMBURSEMENT: 'gray',
}

// ── Add / Edit Drawer ───────────────────────────────────────────────────────

interface ComponentDrawerProps {
  editComponent?: SalaryComponent
  onClose: () => void
}

function ComponentDrawer({ editComponent, onClose }: ComponentDrawerProps) {
  const { toast } = useToast()
  const isEdit = !!editComponent
  const create = useCreateComponent()
  const update = useUpdateComponent()
  const [form, setForm] = useState({
    code: editComponent?.code ?? '',
    name: editComponent?.name ?? '',
    category: editComponent?.category ?? ('EARNING' as ComponentCategory),
    computationType: editComponent?.computationType ?? 'FIXED',
    percentValue: editComponent?.percentValue?.toString() ?? '',
    isStatutory: editComponent?.isStatutory ?? false,
    isTaxable: editComponent?.isTaxable ?? true,
    displayOrder: editComponent?.displayOrder?.toString() ?? '100',
  })

  const set = (key: string, value: unknown) => setForm((p) => ({ ...p, [key]: value }))
  const saving = create.isPending || update.isPending
  const showPercent = form.computationType === 'PERCENT_OF_BASIC'

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast('Code and name are required', 'error')
      return
    }
    const payload: Partial<SalaryComponent> = {
      name: form.name.trim(),
      category: form.category,
      computationType: form.computationType,
      percentValue: showPercent && form.percentValue !== '' ? Number(form.percentValue) : null,
      isStatutory: form.isStatutory,
      isTaxable: form.isTaxable,
      displayOrder: form.displayOrder === '' ? 100 : Number(form.displayOrder),
    }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: editComponent!.id, data: payload })
        toast('Component updated', 'success')
      } else {
        await create.mutateAsync({ ...payload, code: form.code.trim().toUpperCase() })
        toast('Component created', 'success')
      }
      onClose()
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to save component', 'error')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-md bg-white border-l border-slate-200 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-slate-900 font-semibold">{isEdit ? 'Edit Component' : 'Add Component'}</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Code *</label>
              <input
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                disabled={isEdit}
                placeholder="e.g. HRA"
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Display Order</label>
              <input
                type="number"
                min={0}
                value={form.displayOrder}
                onChange={(e) => set('displayOrder', e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Name *</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. House Rent Allowance"
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Category</label>
              <select
                value={form.category}
                onChange={(e) => set('category', e.target.value as ComponentCategory)}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-primary transition-colors"
              >
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Computation</label>
              <select
                value={form.computationType}
                onChange={(e) => set('computationType', e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-primary transition-colors"
              >
                {COMPUTATION_TYPES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          {showPercent && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Percent of Basic (%)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.percentValue}
                onChange={(e) => set('percentValue', e.target.value)}
                placeholder="e.g. 40"
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          )}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isTaxable}
                onChange={(e) => set('isTaxable', e.target.checked)}
                className="rounded border-slate-300 bg-white"
              />
              <span className="text-sm text-slate-700">Taxable</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isStatutory}
                onChange={(e) => set('isStatutory', e.target.checked)}
                className="rounded border-slate-300 bg-white"
              />
              <span className="text-sm text-slate-700">Statutory</span>
            </label>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-slate-200">
          <button onClick={onClose} className="px-4 py-2.5 border border-slate-200 text-slate-500 hover:text-slate-900 rounded-xl text-sm transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-[#FF9D00] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#E08A00] disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Component'}
          </button>
        </div>
      </div>
    </>
  )
}

export const SalaryComponents: React.FC = () => {
  const { toast } = useToast()
  const { data = [], isLoading } = useSalaryComponents()
  const seed = useSeedDefaultComponents()
  const del = useDeleteComponent()
  const [tab, setTab] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<SalaryComponent | null>(null)

  const filtered = useMemo(
    () => tab === 'all' ? data : data.filter(c => c.category === tab),
    [data, tab])

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Payroll"
        title="Salary Components"
        subtitle="The catalog of earnings, deductions and statutory components."
        actions={data.length > 0 && (
          <Can code={P.PAYROLL_COMPONENTS_MANAGE}>
            <HrButton onClick={() => setShowAdd(true)}><Plus size={15} /> Add Component</HrButton>
          </Can>
        )}
      />

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
          <div className="mb-4 flex gap-1 border-b border-border-default">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${tab === t.key ? 'border-[#FF9D00] text-[#C16E00]' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <TableCard>
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Category</th>
                  <th className="hidden sm:table-cell">Statutory</th>
                  <th className="hidden md:table-cell">Computation</th><th></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(4)].map((_, i) => <tr key={i}><td colSpan={6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-sm text-text-tertiary">No components in this category</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id}>
                    <td><span className="hr-mono">{r.code}</span></td>
                    <td className="font-medium text-text-primary">{r.name}</td>
                    <td><HrStatusPill tone={catTone[r.category]}>{r.category.replace('_', ' ')}</HrStatusPill></td>
                    <td className="hidden sm:table-cell">{r.isStatutory ? <HrStatusPill tone="warn">Statutory</HrStatusPill> : <span className="text-text-tertiary">—</span>}</td>
                    <td className="hidden md:table-cell text-text-secondary">{r.computationType}{r.percentValue ? ` (${r.percentValue}%)` : ''}</td>
                    <td>
                      <Can code={P.PAYROLL_COMPONENTS_MANAGE}>
                        {!r.isSystem && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => setEditing(r)} title="Edit" className="rounded-lg p-1.5 text-text-tertiary hover:text-[#C16E00]"><Pencil size={15} /></button>
                            <button onClick={() => del.mutate(r.id, { onSuccess: () => toast('Component deleted', 'success'), onError: (e) => toast((e as Error).message, 'error') })} title="Delete" className="rounded-lg p-1.5 text-text-tertiary hover:text-rose-600"><Trash2 size={15} /></button>
                          </div>
                        )}
                      </Can>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </>
      )}

      {showAdd && <ComponentDrawer onClose={() => setShowAdd(false)} />}
      {editing && <ComponentDrawer editComponent={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
