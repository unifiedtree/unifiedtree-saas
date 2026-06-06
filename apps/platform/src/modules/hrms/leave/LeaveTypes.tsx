import React, { useState } from 'react'
import { Plus, Tag, Loader2, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { TableSkeleton } from '@unifiedtree/ui-kit'
import { useLeaveTypes, useCreateLeaveType, type LeaveTypeResponse } from '../api/useLeave'
import { useCompanies } from '../api/useOrg'

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

interface AddDrawerProps {
  companyId: string
  onClose: () => void
}

function AddDrawer({ companyId, onClose }: AddDrawerProps) {
  const { toast } = useToast()
  const create = useCreateLeaveType()
  const [form, setForm] = useState({
    name: '',
    code: '',
    category: 'CASUAL',
    annualEntitlement: 10,
    maxConsecutiveDays: 5,
    isCarryForwardAllowed: false,
    maxCarryForwardDays: 0,
    isPaidLeave: true,
    description: '',
  })

  const set = (key: string, value: unknown) => setForm((p) => ({ ...p, [key]: value }))

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast('Name and code are required', 'error')
      return
    }
    try {
      await create.mutateAsync({ companyId, data: { ...form } })
      toast('Leave type created', 'success')
      onClose()
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to create leave type', 'error')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-md bg-white border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-text-primary font-semibold">Add Leave Type</h3>
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
            disabled={create.isPending}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors"
          >
            {create.isPending ? 'Saving...' : 'Create Leave Type'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Type Row ──────────────────────────────────────────────────────────────────

function TypeRow({ type }: { type: LeaveTypeResponse }) {
  return (
    <div className={clsx('bg-white border rounded-2xl px-4 py-3 flex items-center gap-4', type.isActive ? 'border-border' : 'border-border/40 opacity-60')}>
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Tag size={15} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-text-primary font-medium text-sm">{type.name}</p>
          <span className="text-xs text-text-secondary font-mono bg-white px-1.5 py-0.5 rounded">{type.code}</span>
          {!type.isActive && <span className="text-xs text-text-secondary bg-white px-2 py-0.5 rounded-full">Inactive</span>}
        </div>
        <p className="text-text-secondary text-xs mt-0.5">
          {type.annualEntitlement} days/year
          {type.isPaidLeave ? ' · Paid' : ' · Unpaid'}
          {type.isCarryForwardAllowed ? ` · Carry fwd up to ${type.maxCarryForwardDays}d` : ''}
        </p>
      </div>
      <span className="text-xs text-slate-600 capitalize">{(type.category ?? '').toLowerCase()}</span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function LeaveTypes() {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: types = [], isLoading } = useLeaveTypes(companyId)
  const create = useCreateLeaveType()
  const [showAdd, setShowAdd] = useState(false)
  const [seeding, setSeeding] = useState(false)

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
      <div className="flex items-center justify-between">
        <p className="text-text-secondary text-sm">Configure leave types available to employees in this company</p>
        <Can code={P.LEAVE_TYPE_WRITE}>
          <div className="flex gap-2">
            {!isLoading && types.length === 0 && (
              <button
                onClick={handleSeedDefaults}
                disabled={seeding}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-xs font-medium rounded-xl border border-amber-500/20 disabled:opacity-50 transition-colors"
              >
                {seeding ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                Seed defaults
              </button>
            )}
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-xl transition-colors"
            >
              <Plus size={13} />
              Add Type
            </button>
          </div>
        </Can>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : types.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border/60 rounded-2xl">
          <Tag size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-text-secondary text-sm font-medium">No leave types configured</p>
          <p className="text-slate-600 text-xs mt-1">Employees cannot apply for leave until at least one type is set up</p>
          <Can code={P.LEAVE_TYPE_WRITE}>
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-sm font-medium rounded-xl border border-amber-500/20 disabled:opacity-50 transition-colors"
            >
              {seeding ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              Add standard Indian leave types (PL + SL + CL)
            </button>
          </Can>
        </div>
      ) : (
        <div className="space-y-2">
          {types.map((t) => <TypeRow key={t.id} type={t} />)}
        </div>
      )}

      {showAdd && companyId && <AddDrawer companyId={companyId} onClose={() => setShowAdd(false)} />}
    </div>
  )
}
