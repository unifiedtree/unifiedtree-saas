import React, { useMemo, useState } from 'react'
import {
  Plus, Archive, Check, FileText, CheckCircle2, Clock, Users, ChevronDown, ChevronUp,
  Pencil, Trash2, Timer,
} from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { usePermission, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { useVisibleTabs } from '@/shared/hooks/useVisibleTabs'
import { TableSkeleton } from '@unifiedtree/ui-kit'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  usePolicies, useMyAcknowledgements, useAcknowledgePolicy, usePolicyAcknowledgements,
  useCreatePolicy, useUpdatePolicy, useArchivePolicy,
  type Policy, type PolicyStatus,
} from './api/usePolicy'
import {
  useShiftPolicies, useCreateShiftPolicy, useUpdateShiftPolicy, useDeleteShiftPolicy,
  type ShiftPolicy, type ShiftPolicyPayload, type ShiftType,
} from './api/useShiftPolicies'
import { LeaveTypes } from './leave/LeaveTypes'

const STATUS_TONE: Record<PolicyStatus, PillTone> = {
  ACTIVE: 'ok', ARCHIVED: 'gray',
}

// Single source of truth for the Rules & Policies tabs — labels, keys, and the
// permission code that gates each. `useVisibleTabs` filters this list per user
// against the SDK auth store (wildcard '*' grants satisfy every check), exactly
// like Leave.tsx gates its 'approvals' tab.
//
// Shift Rules and Leave Rules are the write-side config screens the client
// asked for, so they are gated on the same authorities the backend enforces:
//   • /v1/shifts POST/PUT/DELETE → attendance.regularization.approve
//   • /v1/leave/types write      → leave.type.write
// 'documents' stays ungated at the tab level (its body is guarded by
// hrms.policy.read) so every employee keeps the read + acknowledge screen they
// have today.
const ALL_TABS = [
  { key: 'shifts',    label: 'Shift Rules', requires: P.ATTENDANCE_REGULARIZATION_APPROVE },
  { key: 'leaves',    label: 'Leave Rules', requires: P.LEAVE_TYPE_WRITE },
  { key: 'documents', label: 'Documents' },
  { key: 'manage',    label: 'Manage',      requires: 'hrms.policy.write' },
] as const

type Tab = typeof ALL_TABS[number]['key']

export const Policies: React.FC = () => {
  const canRead = usePermission('hrms.policy.read')
  const canWrite = usePermission('hrms.policy.write')
  const canAcknowledge = usePermission('hrms.policy.acknowledge.self')
  const visibleTabs = useVisibleTabs([...ALL_TABS])

  // 'documents' has no `requires`, so visibleTabs is never empty; the ?? guard
  // is belt-and-braces so a config bug can't render a blank page.
  const [tab, setTab] = useState<Tab>((visibleTabs[0]?.key ?? 'documents') as Tab)
  const activeTab: Tab = visibleTabs.some((t) => t.key === tab)
    ? tab
    : ((visibleTabs[0]?.key ?? 'documents') as Tab)

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader
        crumb="HR Configuration"
        title="Rules & Policies"
        subtitle="Configure shift rules and leave-type rules, and publish the policy documents employees acknowledge"
      />

      <div className="mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border-default bg-white p-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as Tab)}
            className={clsx(
              'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all',
              activeTab === t.key ? 'bg-[#059669] text-white shadow' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'shifts' && <ShiftRulesTab />}
      {activeTab === 'leaves' && <LeaveRulesTab />}
      {activeTab === 'documents' && canRead && <PoliciesTab canAcknowledge={canAcknowledge} />}
      {activeTab === 'manage' && canWrite && <ManageTab />}
    </div>
  )
}

// ── Shift Rules (grace period + overtime rate) ────────────────────────────────

/**
 * Edits `attendance.shift_policies` via /v1/shifts.
 *
 * WHICH GRACE PERIOD IS THIS? There are three grace-period stores in this
 * product and they disagree on both value and default:
 *   1. attendance.shift_policies.grace_period_minutes (default 15) ← this tab
 *   2. settings.hr_configuration.late_grace_minutes   (default 15)
 *   3. org.shifts.grace_minutes                       (default 10)
 * Only (1) is read by the late-mark calculation — AttendanceService
 * getShiftProfile() (~line 666) selects sp.grace_period_minutes from
 * attendance.shift_policies, and the late cutoff is shiftStart.plusMinutes(grace)
 * (~lines 1234-1235). (2) and (3) are configured-but-unread by attendance.
 * So this tab edits ONLY (1). Do not "helpfully" mirror the value into the other
 * two, and do not swap this hook for useOrg's useShifts — that one writes
 * org.shifts, i.e. the wrong table.
 */

const SHIFT_TYPES: { value: ShiftType; label: string }[] = [
  { value: 'FIXED',      label: 'Fixed' },
  { value: 'FLEXIBLE',   label: 'Flexible' },
  { value: 'ROTATIONAL', label: 'Rotational' },
  { value: 'NIGHT',      label: 'Night (may wrap past midnight)' },
]

// Server-side bounds from ShiftDtos.ShiftPolicyRequest — mirrored here so the
// user gets an inline message instead of a 400 from bean validation.
const GRACE_MIN = 0
const GRACE_MAX = 120
const HOURS_MIN = 0.5
const HOURS_MAX = 24
const OT_MIN = 1
const OT_MAX = 9.99

interface ShiftDraft {
  name: string
  shiftType: ShiftType
  startTime: string
  endTime: string
  gracePeriodMinutes: string
  workingHoursPerDay: string
  overtimeApplicable: boolean
  overtimeMultiplier: string
}

const emptyShiftDraft = (): ShiftDraft => ({
  name: '',
  shiftType: 'FIXED',
  startTime: '09:00',
  endTime: '18:00',
  // 15 mirrors the attendance.shift_policies column default.
  gracePeriodMinutes: '15',
  workingHoursPerDay: '8',
  overtimeApplicable: false,
  overtimeMultiplier: '1.5',
})

/** "09:00:00" → "09:00" for <input type="time">; tolerant of null/short values. */
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')

function ShiftRulesTab() {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  const { data: shifts = [], isLoading } = useShiftPolicies(activeCompany)
  const create = useCreateShiftPolicy()
  const update = useUpdateShiftPolicy()
  const remove = useDeleteShiftPolicy()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ShiftDraft>(emptyShiftDraft())

  const set = <K extends keyof ShiftDraft>(key: K, value: ShiftDraft[K]) =>
    setDraft((p) => ({ ...p, [key]: value }))

  const startEdit = (s: ShiftPolicy) => {
    setEditingId(s.id)
    setDraft({
      name: s.name ?? '',
      shiftType: s.shiftType ?? 'FIXED',
      startTime: hhmm(s.startTime) || '09:00',
      endTime: hhmm(s.endTime) || '18:00',
      gracePeriodMinutes: String(s.gracePeriodMinutes ?? 15),
      workingHoursPerDay: s.workingHoursPerDay != null ? String(s.workingHoursPerDay) : '8',
      overtimeApplicable: !!s.overtimeApplicable,
      overtimeMultiplier: s.overtimeMultiplier != null ? String(Number(s.overtimeMultiplier)) : '1.5',
    })
  }

  const reset = () => { setEditingId(null); setDraft(emptyShiftDraft()) }

  const onSave = async () => {
    const name = draft.name.trim()
    if (!name) { toast('Shift name is required', 'error'); return }

    const grace = Number(draft.gracePeriodMinutes)
    if (!Number.isFinite(grace) || grace < GRACE_MIN || grace > GRACE_MAX) {
      toast(`Grace period must be between ${GRACE_MIN} and ${GRACE_MAX} minutes`, 'error'); return
    }
    const hours = Number(draft.workingHoursPerDay)
    if (!Number.isFinite(hours) || hours < HOURS_MIN || hours > HOURS_MAX) {
      toast(`Working hours per day must be between ${HOURS_MIN} and ${HOURS_MAX}`, 'error'); return
    }
    if (draft.startTime === draft.endTime) {
      toast('Shift start and end time must differ', 'error'); return
    }
    // Mirrors EmployeeShiftService.validateShiftWindow: only NIGHT may wrap.
    if (draft.shiftType === 'FIXED' && draft.endTime < draft.startTime) {
      toast('A fixed shift must end after it starts — use the Night type to wrap past midnight', 'error'); return
    }
    const multiplier = Number(draft.overtimeMultiplier)
    if (draft.overtimeApplicable && (!Number.isFinite(multiplier) || multiplier < OT_MIN || multiplier > OT_MAX)) {
      toast(`Overtime rate must be between ${OT_MIN.toFixed(1)} and ${OT_MAX}`, 'error'); return
    }

    const body: ShiftPolicyPayload = {
      name,
      shiftType: draft.shiftType,
      startTime: `${draft.startTime}:00`,
      endTime: `${draft.endTime}:00`,
      gracePeriodMinutes: grace,
      workingHoursPerDay: hours,
      overtimeApplicable: draft.overtimeApplicable,
      // Only send a multiplier when OT is on — the server bound is 1.0..9.99 and
      // rejects anything below 1.0, so a "disabled" shift must omit it entirely.
      ...(draft.overtimeApplicable ? { overtimeMultiplier: multiplier } : {}),
    }

    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, companyId: activeCompany, data: body })
        toast('Shift rule updated', 'success')
      } else {
        if (!activeCompany) { toast('No company available', 'error'); return }
        await create.mutateAsync({ companyId: activeCompany, data: body })
        toast('Shift rule created', 'success')
      }
      reset()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to save shift rule', 'error')
    }
  }

  const onDelete = async (s: ShiftPolicy) => {
    if (!window.confirm(`Delete "${s.name}"? Employees still assigned to it must be moved to another shift first.`)) return
    try {
      await remove.mutateAsync({ id: s.id, companyId: activeCompany })
      toast('Shift rule deleted', 'success')
      if (editingId === s.id) reset()
    } catch (e) {
      // 409 SHIFT_IN_USE carries a "reassign employees first" message from the API.
      toast((e as Error)?.message ?? 'Failed to delete shift rule', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20'
  const saving = create.isPending || update.isPending

  return (
    <div className="space-y-5">
      {companies.length > 1 && !editingId && (
        <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className="rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3">
        <Timer size={16} className="mt-0.5 shrink-0 text-[#2563EB]" />
        <p className="text-xs leading-relaxed text-[#1E40AF]">
          The <strong>grace period</strong> is how many minutes after the shift start a check-in is still
          counted as on time — attendance marks anything later as Late.
          The <strong>overtime rate</strong> is stored on the shift as the configured multiplier for hours
          worked beyond the daily target; payroll does not apply it automatically yet.
        </p>
      </div>

      <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-text-primary">{editingId ? 'Edit shift rule' : 'Add a shift rule'}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Shift name *</label>
            <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. General" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Shift type</label>
            <select value={draft.shiftType} onChange={(e) => set('shiftType', e.target.value as ShiftType)} className={inputCls}>
              {SHIFT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Start time</label>
            <input type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">End time</label>
            <input type="time" value={draft.endTime} onChange={(e) => set('endTime', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Grace period (minutes)</label>
            <input
              type="number"
              min={GRACE_MIN}
              max={GRACE_MAX}
              value={draft.gracePeriodMinutes}
              onChange={(e) => set('gracePeriodMinutes', e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-text-tertiary">{GRACE_MIN}–{GRACE_MAX}. Check-ins within this window are not marked Late.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Working hours per day</label>
            <input
              type="number"
              step="0.5"
              min={HOURS_MIN}
              max={HOURS_MAX}
              value={draft.workingHoursPerDay}
              onChange={(e) => set('workingHoursPerDay', e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-text-tertiary">{HOURS_MIN}–{HOURS_MAX}. The daily target for this shift.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={draft.overtimeApplicable}
                onChange={(e) => set('overtimeApplicable', e.target.checked)}
                className="rounded border-border-default"
              />
              <span className="text-sm text-text-primary">Overtime applicable on this shift</span>
            </label>
          </div>
          {draft.overtimeApplicable && (
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Amount per OT hour (rate multiplier)</label>
              <input
                type="number"
                step="0.25"
                min={OT_MIN}
                max={OT_MAX}
                value={draft.overtimeMultiplier}
                onChange={(e) => set('overtimeMultiplier', e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-text-tertiary">
                {OT_MIN.toFixed(1)}–{OT_MAX} × the normal hourly rate (2.0 = double pay). Stored as the configured rate.
              </p>
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {editingId && <HrButton variant="ghost" onClick={reset}>Cancel</HrButton>}
          <HrButton onClick={onSave} disabled={saving || !activeCompany}>
            {editingId ? <Check size={15} /> : <Plus size={15} />} {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Shift Rule'}
          </HrButton>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : shifts.length === 0 ? (
        <div className="rounded-2xl border border-border-default bg-white py-14 text-center shadow-sm">
          <Clock size={30} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-sm font-semibold text-text-secondary">No shift rules yet</p>
          <p className="mt-1 text-xs text-text-tertiary">Add one above — attendance falls back to a 09:30 late cutoff until a shift is assigned.</p>
        </div>
      ) : (
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Shift</th>
                <th>Timing</th>
                <th>Grace</th>
                <th>Hours / day</th>
                <th>Overtime</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const mult = s.overtimeMultiplier != null ? Number(s.overtimeMultiplier) : null
                return (
                  <tr key={s.id} className={clsx(editingId === s.id && 'bg-[#ECFDF5]')}>
                    <td>
                      <p className="text-[13px] font-semibold text-text-primary">{s.name}</p>
                      <p className="mt-0.5 text-xs capitalize text-text-tertiary">{(s.shiftType ?? '').toLowerCase()}</p>
                    </td>
                    <td className="text-text-secondary">
                      <span className="hr-mono">{hhmm(s.startTime)} – {hhmm(s.endTime)}</span>
                    </td>
                    <td className="text-text-secondary">{s.gracePeriodMinutes} min</td>
                    <td className="text-text-secondary">{s.workingHoursPerDay ?? '—'}</td>
                    <td>
                      {s.overtimeApplicable && mult != null
                        ? <HrStatusPill tone="teal">{mult}× rate</HrStatusPill>
                        : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => startEdit(s)} title="Edit" className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-base hover:text-[#047857]">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => onDelete(s)} title="Delete" className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  )
}

// ── Leave Rules (carry forward) ───────────────────────────────────────────────

/**
 * Embeds the existing LeaveTypes screen rather than forking its form — it is
 * already the only place that edits isCarryForwardAllowed + maxCarryForwardDays
 * against /v1/leave/types, and it mounts standalone (resolves its own company).
 * Two forms writing the same fields would drift within a release.
 */
function LeaveRulesTab() {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3">
        <FileText size={16} className="mt-0.5 shrink-0 text-[#2563EB]" />
        <p className="text-xs leading-relaxed text-[#1E40AF]">
          Each leave type carries its own rules — annual entitlement, paid/unpaid, and whether unused days
          may be carried forward. <strong>Carry forward</strong> here is the configured allowance
          (on/off plus a maximum number of days) recorded against the leave type.
        </p>
      </div>
      <LeaveTypes
        crumb="Rules & Policies"
        subtitle="Entitlement, paid status and carry-forward allowance per leave type"
      />
    </div>
  )
}

// ── Documents (read + acknowledge) ────────────────────────────────────────────
// Unchanged body of the former 'policies' tab — the document policy centre.

function PoliciesTab({ canAcknowledge }: { canAcknowledge: boolean }) {
  const { toast } = useToast()
  const { data, isLoading } = usePolicies(0)
  const { data: myAcks = [] } = useMyAcknowledgements()
  const acknowledge = useAcknowledgePolicy()
  const [openId, setOpenId] = useState<string | null>(null)

  const policies = data?.content ?? []
  const ackSet = useMemo(() => new Set(myAcks), [myAcks])

  const stats = useMemo(() => {
    const total = policies.length
    const acknowledged = policies.filter((p) => ackSet.has(p.id)).length
    const pending = total - acknowledged
    return { total, acknowledged, pending }
  }, [policies, ackSet])

  const onAcknowledge = async (id: string) => {
    try {
      await acknowledge.mutateAsync(id)
      toast('Policy acknowledged', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to acknowledge', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <HrStatCard icon={<FileText size={18} />} color="blue" value={stats.total} label="Active Policies" loading={isLoading} />
        <HrStatCard icon={<CheckCircle2 size={18} />} color="green" value={stats.acknowledged} label="Acknowledged" loading={isLoading} />
        <HrStatCard icon={<Clock size={18} />} color="orange" value={stats.pending} label="Pending" loading={isLoading} />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 w-full animate-pulse rounded-2xl bg-bg-base" />)}
        </div>
      ) : policies.length === 0 ? (
        <div className="rounded-2xl border border-border-default bg-white py-14 text-center shadow-sm">
          <p className="text-sm font-semibold text-text-secondary">No active policies</p>
          <p className="mt-1 text-xs text-text-tertiary">Published policies will appear here for you to read and acknowledge.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {policies.map((p) => {
            const acked = ackSet.has(p.id)
            const open = openId === p.id
            return (
              <div key={p.id} className="rounded-2xl border border-border-default bg-white shadow-sm">
                <button
                  onClick={() => setOpenId(open ? null : p.id)}
                  className="flex w-full items-start justify-between gap-3 p-5 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-text-primary">{p.title}</span>
                      {p.category && <HrStatusPill tone="info">{p.category}</HrStatusPill>}
                      {p.version && <span className="text-xs font-medium text-text-tertiary">{p.version}</span>}
                      {acked && <HrStatusPill tone="ok">Acknowledged</HrStatusPill>}
                    </div>
                    <p className="mt-1 text-xs text-text-tertiary">
                      {p.effectiveDate ? `Effective ${format(new Date(p.effectiveDate), 'd MMM yyyy')}` : 'No effective date'}
                    </p>
                  </div>
                  <span className="mt-0.5 text-text-tertiary">{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                </button>

                {open && (
                  <div className="border-t border-border-default px-5 py-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                      {p.content?.trim() || 'No content provided for this policy.'}
                    </p>
                    {canAcknowledge && (
                      <div className="mt-4 flex justify-end">
                        {acked ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#15803D]">
                            <CheckCircle2 size={15} /> You acknowledged this policy
                          </span>
                        ) : (
                          <HrButton onClick={() => onAcknowledge(p.id)} disabled={acknowledge.isPending}>
                            <Check size={14} /> Acknowledge
                          </HrButton>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Manage (admin: create / edit / archive policy documents) ──────────────────
// Unchanged body of the existing 'manage' tab.

interface DraftPolicy {
  title: string
  category: string
  version: string
  effectiveDate: string
  content: string
}

const emptyDraft = (): DraftPolicy => ({
  title: '', category: '', version: '', effectiveDate: new Date().toISOString().slice(0, 10), content: '',
})

function ManageTab() {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  const { data, isLoading } = usePolicies(0)
  const create = useCreatePolicy()
  const update = useUpdatePolicy()
  const archive = useArchivePolicy()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftPolicy>(emptyDraft())
  const [detailId, setDetailId] = useState<string | null>(null)

  const policies = data?.content ?? []

  const startEdit = (p: Policy) => {
    setEditingId(p.id)
    setDraft({
      title: p.title,
      category: p.category ?? '',
      version: p.version ?? '',
      effectiveDate: p.effectiveDate ?? new Date().toISOString().slice(0, 10),
      content: p.content ?? '',
    })
  }

  const reset = () => { setEditingId(null); setDraft(emptyDraft()) }

  const onSave = async () => {
    if (!draft.title.trim()) { toast('Policy title is required', 'error'); return }
    const body = {
      title: draft.title.trim(),
      category: draft.category.trim() || undefined,
      version: draft.version.trim() || undefined,
      effectiveDate: draft.effectiveDate || undefined,
      content: draft.content.trim() || undefined,
    }
    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, ...body })
        toast('Policy updated', 'success')
      } else {
        if (!activeCompany) { toast('No company available', 'error'); return }
        await create.mutateAsync({ companyId: activeCompany, ...body })
        toast('Policy published', 'success')
      }
      reset()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to save policy', 'error')
    }
  }

  const onArchive = async (id: string) => {
    try {
      await archive.mutateAsync(id)
      toast('Policy archived', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to archive', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20'
  const saving = create.isPending || update.isPending

  return (
    <div className="space-y-5">
      {companies.length > 1 && !editingId && (
        <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className="rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-text-primary">{editingId ? 'Edit policy' : 'Publish a policy'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Title *</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Remote Work Policy" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Category</label>
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="e.g. Workplace" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Version</label>
            <input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} placeholder="e.g. v1.0" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Effective date</label>
            <input type="date" value={draft.effectiveDate} onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Content</label>
            <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={5} placeholder="The full policy text employees will read and acknowledge" className={inputCls} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {editingId && <HrButton variant="ghost" onClick={reset}>Cancel</HrButton>}
          <HrButton onClick={onSave} disabled={saving}>
            {editingId ? <Check size={15} /> : <Plus size={15} />} {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Publish Policy'}
          </HrButton>
        </div>
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Category</th>
              <th>Version</th>
              <th>Acknowledged</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : policies.length === 0 ? (
              <tr><td colSpan={6} className="py-14 text-center text-sm text-text-tertiary">No policies published yet.</td></tr>
            ) : policies.map((p) => (
              <React.Fragment key={p.id}>
                <tr>
                  <td className="font-medium text-text-primary">{p.title}</td>
                  <td className="text-text-secondary">{p.category || '—'}</td>
                  <td className="text-text-secondary">{p.version || '—'}</td>
                  <td>
                    <button onClick={() => setDetailId(detailId === p.id ? null : p.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#047857] hover:text-[#064E3B]">
                      <Users size={14} /> {p.acknowledgementCount}
                    </button>
                  </td>
                  <td><HrStatusPill tone={STATUS_TONE[p.status]}>{p.status}</HrStatusPill></td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <HrButton size="sm" variant="ghost" onClick={() => startEdit(p)}>Edit</HrButton>
                      {p.status === 'ACTIVE' && (
                        <button onClick={() => onArchive(p.id)} className="rounded-lg p-1.5 text-text-tertiary hover:bg-[#FEE2E2] hover:text-[#B91C1C]" title="Archive">
                          <Archive size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {detailId === p.id && (
                  <tr>
                    <td colSpan={6} className="bg-bg-base/40 p-0">
                      <AcknowledgementList policyId={p.id} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}

function AcknowledgementList({ policyId }: { policyId: string }) {
  const { data, isLoading } = usePolicyAcknowledgements(policyId, 0)
  const acks = data?.content ?? []

  if (isLoading) {
    return <div className="p-4"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></div>
  }
  if (acks.length === 0) {
    return <p className="p-4 text-center text-xs text-text-tertiary">No acknowledgements yet.</p>
  }
  return (
    <div className="space-y-2 p-4">
      {acks.map((a, i) => (
        <div key={a.id} className="flex items-center justify-between">
          <HrAvatar name={a.employeeName || 'Employee'} sub={a.employeeCode} seed={i} />
          <span className="text-xs text-text-tertiary">
            {a.acknowledgedAt ? format(new Date(a.acknowledgedAt), 'd MMM yyyy, HH:mm') : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
