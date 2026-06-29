import React, { useState } from 'react'
import { Plus, Tag, Loader2, Zap, Pencil, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { TableSkeleton } from '@unifiedtree/ui-kit'
import { useLeaveTypes, useCreateLeaveType, useUpdateLeaveType, useDeactivateLeaveType, type LeaveTypeResponse } from '../api/useLeave'
import { useCompanies } from '../api/useOrg'
import { HrPageHeader, HrButton, HrStatusPill, TableCard } from '@/shared/components/hr'

// Indian standard: PL 1.5/month (18/year) carry-forward max 30;
// SL 1/month (12/year) no carry-forward; CL 1/month (12/year) no carry-forward.
const INDIAN_DEFAULTS = [
  {
    name: 'Privilege Leave',
    code: 'PL',
    category: 'EARNED',
    annualEntitlement: 18,
    maxConsecutiveDays: 15,
    isCarryForwardAllowed: true,
    maxCarryForwardDays: 30,
    isPaidLeave: true,
    description: 'Annual earned leave (1.5 days/month)',
  },
  {
    name: 'Sick Leave',
    code: 'SL',
    category: 'SICK',
    annualEntitlement: 12,
    maxConsecutiveDays: 5,
    isCarryForwardAllowed: false,
    maxCarryForwardDays: 0,
    isPaidLeave: true,
    description: 'Medical and illness leave (1 day/month)',
  },
  {
    name: 'Casual Leave',
    code: 'CL',
    category: 'CASUAL',
    annualEntitlement: 12,
    maxConsecutiveDays: 5,
    isCarryForwardAllowed: false,
    maxCarryForwardDays: 0,
    isPaidLeave: true,
    description: 'Short-duration unplanned leave (1 day/month)',
  },
]

// ── Add Drawer ────────────────────────────────────────────────────────────────

interface TypeDrawerProps {
  companyId: string
  editType?: LeaveTypeResponse
  onClose: () => void
}

function TypeDrawer({ companyId, editType, onClose }: TypeDrawerProps) {
  const { toast } = useToast()
  const isEdit = !!editType
  const create = useCreateLeaveType()
  const update = useUpdateLeaveType()
  const [form, setForm] = useState({
    name: editType?.name ?? '',
    code: editType?.code ?? '',
    category: editType?.category ?? 'CASUAL',
    annualEntitlement: editType?.annualEntitlement ?? 10,
    maxConsecutiveDays: editType?.maxConsecutiveDays ?? 5,
    isCarryForwardAllowed: editType?.isCarryForwardAllowed ?? false,
    maxCarryForwardDays: editType?.maxCarryForwardDays ?? 0,
    isPaidLeave: editType?.isPaidLeave ?? true,
    description: '',
  })

  const set = (key: string, value: unknown) => setForm((p) => ({ ...p, [key]: value }))
  const saving = create.isPending || update.isPending

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast('Name and code are required', 'error')
      return
    }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: editType!.id, data: { ...form } })
        toast('Leave type updated', 'success')
      } else {
        await create.mutateAsync({ companyId, data: { ...form } })
        toast('Leave type created', 'success')
      }
      onClose()
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to save leave type', 'error')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-md bg-white border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-text-primary font-semibold">{isEdit ? 'Edit Leave Type' : 'Add Leave Type'}</h3>
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-white/5">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Name *</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Privilege Leave"
              className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Code *</label>
              <input
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="PL"
                className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Category</label>
              <select
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
              >
                <option value="EARNED">Earned / Privilege</option>
                <option value="SICK">Sick</option>
                <option value="CASUAL">Casual</option>
                <option value="MATERNITY">Maternity</option>
                <option value="PATERNITY">Paternity</option>
                <option value="COMPENSATORY">Compensatory</option>
                <option value="BEREAVEMENT">Bereavement</option>
                <option value="UNPAID">Unpaid</option>
                <option value="STUDY">Study</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Days / Year</label>
              <input
                type="number"
                min={0}
                value={form.annualEntitlement}
                onChange={(e) => set('annualEntitlement', Number(e.target.value))}
                className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Max Consecutive</label>
              <input
                type="number"
                min={0}
                value={form.maxConsecutiveDays}
                onChange={(e) => set('maxConsecutiveDays', Number(e.target.value))}
                className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isPaidLeave}
                onChange={(e) => set('isPaidLeave', e.target.checked)}
                className="rounded border-slate-600 bg-white"
              />
              <span className="text-sm text-text-primary">Paid Leave</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isCarryForwardAllowed}
                onChange={(e) => set('isCarryForwardAllowed', e.target.checked)}
                className="rounded border-slate-600 bg-white"
              />
              <span className="text-sm text-text-primary">Carry Forward</span>
            </label>
          </div>
          {form.isCarryForwardAllowed && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Max Carry Forward Days</label>
              <input
                type="number"
                min={0}
                value={form.maxCarryForwardDays}
                onChange={(e) => set('maxCarryForwardDays', Number(e.target.value))}
                className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="Optional"
              className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary resize-none transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-border">
          <button onClick={onClose} className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-[#FF9D00] hover:bg-[#E08A00] disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors"
          >
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Leave Type'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Type Row ──────────────────────────────────────────────────────────────────

function TypeRow({ type, onEdit, onDeactivate }: { type: LeaveTypeResponse; onEdit: (t: LeaveTypeResponse) => void; onDeactivate: (t: LeaveTypeResponse) => void }) {
  return (
    <tr className={clsx(!type.isActive && 'opacity-60')}>
      <td>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#FFF4E1] flex items-center justify-center flex-shrink-0">
            <Tag size={15} className="text-[#C16E00]" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">{type.name}</p>
            <p className="text-text-tertiary text-xs mt-0.5">
              {type.annualEntitlement} days/year
              {type.isPaidLeave ? ' · Paid' : ' · Unpaid'}
              {type.isCarryForwardAllowed ? ` · Carry fwd up to ${type.maxCarryForwardDays}d` : ''}
            </p>
          </div>
        </div>
      </td>
      <td><span className="hr-mono text-text-secondary">{type.code}</span></td>
      <td><span className="text-xs text-text-secondary capitalize">{(type.category ?? '').toLowerCase()}</span></td>
      <td>
        {type.isActive
          ? <HrStatusPill tone="ok">Active</HrStatusPill>
          : <HrStatusPill tone="gray">Inactive</HrStatusPill>}
      </td>
      <Can code={P.LEAVE_TYPE_WRITE}>
        <td className="text-right">
          <div className="inline-flex items-center gap-1">
            <button onClick={() => onEdit(type)} title="Edit" className="p-1.5 text-text-tertiary hover:text-[#C16E00] rounded-lg hover:bg-bg-base transition-colors">
              <Pencil size={14} />
            </button>
            <button onClick={() => onDeactivate(type)} title="Deactivate" className="p-1.5 text-text-tertiary hover:text-[#EF4444] rounded-lg hover:bg-bg-base transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </Can>
    </tr>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function LeaveTypes() {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: types = [], isLoading } = useLeaveTypes(companyId)
  const create = useCreateLeaveType()
  const deactivate = useDeactivateLeaveType()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<LeaveTypeResponse | null>(null)
  const [seeding, setSeeding] = useState(false)

  const handleDeactivate = async (type: LeaveTypeResponse) => {
    if (!window.confirm(`Deactivate "${type.name}"? Employees will no longer be able to apply under this leave type.`)) return
    try {
      await deactivate.mutateAsync(type.id)
      toast('Leave type deactivated', 'success')
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to deactivate leave type', 'error')
    }
  }

  const handleSeedDefaults = async () => {
    if (!companyId) return
    const missing = INDIAN_DEFAULTS.filter((d) => !types.some((t) => t.code === d.code))
    if (missing.length === 0) {
      toast('Standard leave types already exist', 'success')
      return
    }
    setSeeding(true)
    try {
      for (const lt of missing) {
        await create.mutateAsync({ companyId, data: lt })
      }
      toast(`${missing.length} leave type${missing.length > 1 ? 's' : ''} added`, 'success')
    } catch {
      toast('Some leave types could not be created', 'error')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="space-y-4">
      <HrPageHeader
        crumb="Leave Management"
        title="Leave Types"
        subtitle="Configure leave types available to employees in this company"
        actions={
          <Can code={P.LEAVE_TYPE_WRITE}>
            {!isLoading && types.length === 0 && (
              <HrButton variant="ghost" onClick={handleSeedDefaults} disabled={seeding}>
                {seeding ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                Seed defaults
              </HrButton>
            )}
            <HrButton onClick={() => setShowAdd(true)}>
              <Plus size={13} />
              Add Type
            </HrButton>
          </Can>
        }
      />

      {isLoading ? (
        <TableSkeleton />
      ) : types.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border-default rounded-xl bg-white">
          <Tag size={32} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm font-medium">No leave types configured</p>
          <p className="text-text-tertiary text-xs mt-1">Employees cannot apply for leave until at least one type is set up</p>
          <Can code={P.LEAVE_TYPE_WRITE}>
            <div className="mt-4">
              <HrButton variant="ghost" onClick={handleSeedDefaults} disabled={seeding}>
                {seeding ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Add standard Indian leave types (PL + SL + CL)
              </HrButton>
            </div>
          </Can>
        </div>
      ) : (
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Leave Type</th>
                <th>Code</th>
                <th>Category</th>
                <th>Status</th>
                <Can code={P.LEAVE_TYPE_WRITE}>
                  <th className="text-right">Actions</th>
                </Can>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => <TypeRow key={t.id} type={t} onEdit={setEditing} onDeactivate={handleDeactivate} />)}
            </tbody>
          </table>
        </TableCard>
      )}

      {showAdd && companyId && <TypeDrawer companyId={companyId} onClose={() => setShowAdd(false)} />}
      {editing && <TypeDrawer companyId={companyId} editType={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
