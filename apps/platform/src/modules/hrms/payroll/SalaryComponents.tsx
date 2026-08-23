import React, { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { EmptyState } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { HrPageHeader, HrButton, HrStatusPill, HrTabs, HrTabPanel, HrDrawer, HrSelect, TableCard, type PillTone } from '@/shared/components/hr'
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

// Visual-only sentence-case transform for the COMPUTATION column
// (e.g. PERCENT_OF_BASIC → "Percent of basic"). Stored values untouched.
const sentenceCase = (s: string) => {
  const t = s.replace(/_/g, ' ').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
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
    <HrDrawer
      title={isEdit ? 'Edit Component' : 'Add Component'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2.5 border border-slate-200 text-slate-500 hover:text-slate-900 rounded-xl text-sm transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-[#059669] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#047857] disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Component'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <label className="block text-[13px] font-semibold text-slate-500 mb-1.5">Code *</label>
              <input
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                disabled={isEdit}
                placeholder="e.g. HRA"
                className="ut-input w-full"
              />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-slate-500 mb-1.5">Display Order</label>
              <input
                type="number"
                min={0}
                value={form.displayOrder}
                onChange={(e) => set('displayOrder', e.target.value)}
                className="ut-input w-full"
              />
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-500 mb-1.5">Name *</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. House Rent Allowance"
              className="ut-input w-full"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <label className="block text-[13px] font-semibold text-slate-500 mb-1.5">Category</label>
              <HrSelect
                value={form.category}
                onChange={(v) => set('category', v as ComponentCategory)}
                options={CATEGORIES}
              />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-slate-500 mb-1.5">Computation</label>
              <HrSelect
                value={form.computationType}
                onChange={(v) => set('computationType', v)}
                options={COMPUTATION_TYPES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
              />
            </div>
          </div>
          {showPercent && (
            <div>
              <label className="block text-[13px] font-semibold text-slate-500 mb-1.5">Percent of Basic (%)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.percentValue}
                onChange={(e) => set('percentValue', e.target.value)}
                placeholder="e.g. 40"
                className="ut-input w-full"
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
    </HrDrawer>
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
          <HrTabs tabs={TABS} active={tab} onChange={setTab} />
          <HrTabPanel tabKey={tab}>
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
                      <td><span className="font-mono text-[12px] text-[var(--text-tertiary)]">{r.code}</span></td>
                      <td className="font-semibold text-text-primary">{r.name}</td>
                      <td><HrStatusPill tone={catTone[r.category]}>{r.category.replace('_', ' ')}</HrStatusPill></td>
                      <td className="hidden sm:table-cell">{r.isStatutory ? <HrStatusPill tone="warn">Statutory</HrStatusPill> : <span className="text-text-tertiary">—</span>}</td>
                      <td className="hidden md:table-cell text-text-secondary">{sentenceCase(r.computationType)}{r.percentValue ? ` (${r.percentValue}%)` : ''}</td>
                      <td>
                        <Can code={P.PAYROLL_COMPONENTS_MANAGE}>
                          {!r.isSystem && (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => setEditing(r)} title="Edit" aria-label="Edit component" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"><Pencil size={15} /></button>
                              <button onClick={() => del.mutate(r.id, { onSuccess: () => toast('Component deleted', 'success'), onError: (e) => toast((e as Error).message, 'error') })} title="Delete" aria-label="Delete component" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-rose-600"><Trash2 size={15} /></button>
                            </div>
                          )}
                        </Can>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </HrTabPanel>
        </>
      )}

      {showAdd && <ComponentDrawer onClose={() => setShowAdd(false)} />}
      {editing && <ComponentDrawer editComponent={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
