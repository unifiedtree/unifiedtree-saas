import React, { useMemo, useState } from 'react'
import {
  Plus, Archive, ArchiveRestore, Check, FileText, CheckCircle2, Clock, Users, ChevronDown, ChevronUp,
  Pencil, Trash2, Timer,
} from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { usePermission, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { useVisibleTabs } from '@/shared/hooks/useVisibleTabs'
import { TableSkeleton } from '@unifiedtree/ui-kit'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, HrTabs, HrTabPanel, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  usePolicies, useMyAcknowledgements, useAcknowledgePolicy, usePolicyAcknowledgements,
  useCreatePolicy, useUpdatePolicy, useArchivePolicy, useUnarchivePolicy,
  type Policy, type PolicyStatus,
} from './api/usePolicy'
import {
  useShiftPolicies, useCreateShiftPolicy, useUpdateShiftPolicy, useDeleteShiftPolicy,
  type ShiftPolicy, type ShiftPolicyPayload, type ShiftType,
} from './api/useShiftPolicies'
import { LeaveTypes } from './leave/LeaveTypes'

// DRAFT was missing because the SPA's PolicyStatus type predated it, and the
// ARCHIVED entry was unreachable dead code until the Manage tab gained a status
// filter below — the admin table only ever fetched ACTIVE, so no row could
// render any tone but 'ok'. Both are live now.
const STATUS_TONE: Record<PolicyStatus, PillTone> = {
  DRAFT: 'warn', ACTIVE: 'ok', ARCHIVED: 'gray',
}

// The three states com.hrms.policy.enums.PolicyStatus actually has, in
// lifecycle order. No "All" entry: the list endpoint takes a single status and
// maps null → ACTIVE (PolicyService.listPolicies), so an "All" button could
// only re-show the Active rows under a label that promises everything —
// exactly the kind of quiet lie that hid the archived policies in the first
// place. One state at a time, honestly labelled.
const MANAGE_FILTERS: { value: PolicyStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ARCHIVED', label: 'Archived' },
]

const EMPTY_COPY: Record<PolicyStatus, string> = {
  ACTIVE: 'No active policies yet — publish one above.',
  DRAFT: 'No draft policies.',
  ARCHIVED: 'Nothing archived. Archived policies land here and can be restored.',
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
// 2026-09-10: 'documents' used to have NO `requires`, so useVisibleTabs
// always kept it in the list, but the body was guarded by
// hrms.policy.read. A user holding ONLY hrms.policy.acknowledge.self
// (a custom RBAC configuration) or ONLY write-not-read landed on the
// default tab and saw a completely blank panel — no empty state, no
// error, nothing. Gating the tab on the same permission the body checks
// removes it entirely for those users; the body-side guard stays as a
// belt-and-braces defence.
const ALL_TABS = [
  { key: 'shifts',    label: 'Shift Rules', requires: P.ATTENDANCE_REGULARIZATION_APPROVE },
  { key: 'leaves',    label: 'Leave Rules', requires: P.LEAVE_TYPE_WRITE },
  { key: 'documents', label: 'Documents',   requires: 'hrms.policy.read' },
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

      <HrTabs
        tabs={visibleTabs.map((t) => ({ key: t.key, label: t.label }))}
        active={activeTab}
        onChange={(k) => setTab(k as Tab)}
      />

      {/* Every tab now has a `requires`, so an unlucky role could land here
          with nothing visible. Say so honestly instead of an empty page. */}
      {visibleTabs.length === 0 && (
        <div className="ut-card mt-5 p-10 text-center">
          <p className="text-sm font-semibold text-text-secondary">No policies access for this role</p>
          <p className="mt-1 text-xs text-text-tertiary">
            Ask an administrator to grant a Policies permission from Settings → Roles & Permissions.
          </p>
        </div>
      )}

      <HrTabPanel tabKey={activeTab}>
        {activeTab === 'shifts' && <ShiftRulesTab />}
        {activeTab === 'leaves' && <LeaveRulesTab />}
        {activeTab === 'documents' && canRead && <PoliciesTab canAcknowledge={canAcknowledge} />}
        {activeTab === 'manage' && canWrite && <ManageTab canWrite={canWrite} />}
      </HrTabPanel>
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

  const inputCls = 'ut-input'
  const saving = create.isPending || update.isPending

  return (
    <div className="space-y-5">
      {companies.length > 1 && !editingId && (
        <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className="ut-select ut-select-sm w-auto">
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

      <div className="ut-card ut-card-lg p-5">
        <h3 className="mb-4 text-[15px] font-semibold text-text-primary">{editingId ? 'Edit shift rule' : 'Add a shift rule'}</h3>
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Shift name *</label>
            <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. General" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Shift type</label>
            <select value={draft.shiftType} onChange={(e) => set('shiftType', e.target.value as ShiftType)} className="ut-select">
              {SHIFT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Start time</label>
            <input type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">End time</label>
            <input type="time" value={draft.endTime} onChange={(e) => set('endTime', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Grace period (minutes)</label>
            <input
              type="number"
              min={GRACE_MIN}
              max={GRACE_MAX}
              value={draft.gracePeriodMinutes}
              onChange={(e) => set('gracePeriodMinutes', e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">{GRACE_MIN}–{GRACE_MAX}. Check-ins within this window are not marked Late.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Working hours per day</label>
            <input
              type="number"
              step="0.5"
              min={HOURS_MIN}
              max={HOURS_MAX}
              value={draft.workingHoursPerDay}
              onChange={(e) => set('workingHoursPerDay', e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">{HOURS_MIN}–{HOURS_MAX}. The daily target for this shift.</p>
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
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Amount per OT hour (rate multiplier)</label>
              <input
                type="number"
                step="0.25"
                min={OT_MIN}
                max={OT_MAX}
                value={draft.overtimeMultiplier}
                onChange={(e) => set('overtimeMultiplier', e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
                {OT_MIN.toFixed(1)}–{OT_MAX} × the normal hourly rate (2.0 = double pay). Stored as the configured rate.
              </p>
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
          {editingId && <HrButton variant="ghost" onClick={reset}>Cancel</HrButton>}
          <HrButton onClick={onSave} disabled={saving || !activeCompany}>
            {editingId ? <Check size={15} /> : <Plus size={15} />} {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Shift Rule'}
          </HrButton>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : shifts.length === 0 ? (
        <div className="ut-card py-14 text-center">
          <Clock size={30} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-sm font-semibold text-text-secondary">No shift rules yet</p>
          <p className="mt-1 text-xs text-text-tertiary">Add one above — attendance falls back to a 09:30 late cutoff until a shift is assigned.</p>
        </div>
      ) : (
        <TableCard>
          <table className="hr-table [&_tbody_td]:!py-2.5">
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
                    <td className="tabular-nums text-text-secondary">{s.gracePeriodMinutes} min</td>
                    <td className="tabular-nums text-text-secondary">{s.workingHoursPerDay ?? '—'}</td>
                    <td>
                      {s.overtimeApplicable && mult != null
                        ? <HrStatusPill tone="teal">{mult}× rate</HrStatusPill>
                        : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button onClick={() => startEdit(s)} aria-label={`Edit shift rule ${s.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => onDelete(s)} aria-label={`Delete shift rule ${s.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]">
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
  // 2026-09-10: Shift Rules and Manage both render a company <select> when
  // there are multiple companies. Leave Rules didn't, so LeaveTypes silently
  // read and wrote only the FIRST company's leave types — with no control to
  // switch and no indication which company was in effect. Mirror the pattern
  // used by the other tabs here rather than in the shared LeaveTypes widget,
  // so the /hrms/leave-types standalone page is untouched.
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompanyId = companyId || companies[0]?.id || ''

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
      {companies.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-text-secondary">Company</label>
          <select
            value={activeCompanyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rounded-lg border border-border-default bg-white px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-[#059669]/30"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
      <LeaveTypes
        crumb="Rules & Policies"
        subtitle="Entitlement, paid status and carry-forward allowance per leave type"
        companyId={activeCompanyId}
      />
    </div>
  )
}

// ── Documents (read + acknowledge) ────────────────────────────────────────────
// Unchanged body of the former 'policies' tab — the document policy centre.

function PoliciesTab({ canAcknowledge }: { canAcknowledge: boolean }) {
  const { toast } = useToast()
  // ACTIVE is pinned explicitly rather than left to the server default. It is
  // the same request, but it pins this screen to its own cache entry: the
  // Manage tab can now fetch ARCHIVED, and a shared key would let an admin's
  // archived list be rendered here as policies to acknowledge.
  const { data, isLoading } = usePolicies(0, 'ACTIVE')
  const { data: myAcks = [] } = useMyAcknowledgements()
  const acknowledge = useAcknowledgePolicy()
  const [openId, setOpenId] = useState<string | null>(null)

  const policies = data?.content ?? []
  // Derived per render from the query — never mirrored into state. The server
  // list is scoped to each policy's CURRENT version, so an id can legitimately
  // drop out after an admin bumps a version, and this Set has to be able to
  // shrink for the Acknowledge button to come back. See useMyAcknowledgements.
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
          {[...Array(3)].map((_, i) => <div key={i} className="ut-card h-20 w-full animate-pulse" />)}
        </div>
      ) : policies.length === 0 ? (
        <div className="ut-card py-14 text-center">
          <p className="text-sm font-semibold text-text-secondary">No active policies</p>
          <p className="mt-1 text-xs text-text-tertiary">Published policies will appear here for you to read and acknowledge.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {policies.map((p) => {
            const acked = ackSet.has(p.id)
            const open = openId === p.id
            return (
              <div key={p.id} className="ut-card">
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
                      // `acked` is read straight off the server's version-scoped
                      // list on every render, so when an admin bumps this
                      // policy's version the id leaves that list and the
                      // Acknowledge button replaces this label — which is the
                      // point, since the employee has not agreed to the new
                      // text. Do not memoise, freeze or optimistically pin this
                      // to true: the acknowledgement is per version, not per
                      // policy, and the re-ack path is the whole feature.
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

function ManageTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  // Which lifecycle state the table is showing. Defaults to ACTIVE, which is
  // what this table always showed — the difference is that ARCHIVED is now
  // reachable instead of being a state you could only enter, never leave.
  const [statusFilter, setStatusFilter] = useState<PolicyStatus>('ACTIVE')

  const { data, isLoading } = usePolicies(0, statusFilter)
  const create = useCreatePolicy()
  const update = useUpdatePolicy()
  const archive = useArchivePolicy()
  const unarchive = useUnarchivePolicy()

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
        // A create always lands as ACTIVE (PolicyService.createPolicy defaults
        // the status when the request omits it), so snap the filter back —
        // otherwise publishing from the Archived or Draft view reports success
        // against a table the new row cannot appear in.
        setStatusFilter('ACTIVE')
      }
      reset()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to save policy', 'error')
    }
  }

  /**
   * Archiving USED TO BE a one-click irreversible destruction: no confirm, and
   * because this table only ever fetched ACTIVE the row vanished the instant
   * the icon was hit, with no unarchive endpoint and no way to list archived
   * policies. A single misclick removed a published policy from the product
   * and recovery meant editing the database by hand.
   *
   * The confirm names the policy — a generic "Are you sure?" is dismissed on
   * autopilot and would not have caught the misclick — and states where the
   * row goes, so the undo is discoverable BEFORE the click rather than
   * discovered as missing afterwards.
   */
  const onArchive = async (p: Policy) => {
    if (!window.confirm(
      `Archive "${p.title}"?\n\n`
      + 'Employees will stop seeing it in Documents and can no longer acknowledge it. '
      + 'You can bring it back at any time from the Archived filter on this tab.',
    )) return
    try {
      await archive.mutateAsync(p.id)
      toast(`"${p.title}" archived — restore it from the Archived filter`, 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to archive', 'error')
    }
  }

  /**
   * ARCHIVED → ACTIVE. No confirm here on purpose: restoring is the
   * non-destructive direction and is itself undone by one Archive click, so
   * a second dialog would only train people to click through dialogs.
   */
  const onRestore = async (p: Policy) => {
    try {
      await unarchive.mutateAsync(p.id)
      // The row leaves this list on refetch (it is ACTIVE now, and the table is
      // filtered to ARCHIVED), so the toast has to say where it went.
      toast(`"${p.title}" restored — it is active for employees again`, 'success')
    } catch (e) {
      // 400 POLICY_NOT_ARCHIVED when another admin already restored it.
      toast((e as Error)?.message ?? 'Failed to restore policy', 'error')
    }
  }

  const inputCls = 'ut-input'
  const saving = create.isPending || update.isPending

  return (
    <div className="space-y-5">
      {companies.length > 1 && !editingId && (
        <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className="ut-select ut-select-sm w-auto">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      <div className="ut-card ut-card-lg p-5">
        <h3 className="mb-4 text-[15px] font-semibold text-text-primary">{editingId ? 'Edit policy' : 'Publish a policy'}</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <div className="col-span-2">
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Title *</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Remote Work Policy" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Category</label>
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="e.g. Workplace" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Version</label>
            <input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} placeholder="e.g. v1.0" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Effective date</label>
            <input type="date" value={draft.effectiveDate} onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Content</label>
            <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={5} placeholder="The full policy text employees will read and acknowledge" className="w-full rounded-xl border border-border-default bg-white/90 px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus:border-[var(--border-focus)] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#059669]/10" />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
          {editingId && <HrButton variant="ghost" onClick={reset}>Cancel</HrButton>}
          <HrButton onClick={onSave} disabled={saving}>
            {editingId ? <Check size={15} /> : <Plus size={15} />} {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Publish Policy'}
          </HrButton>
        </div>
      </div>

      {/* The only route to an archived policy. Without it the table was pinned
          to the server's ACTIVE default, so archiving was a trapdoor. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border-default bg-white p-0.5">
          {MANAGE_FILTERS.map((f) => (
            <button
              key={f.value}
              // Only the expanded acknowledgement row is reset — `editingId` is
              // deliberately left alone so switching filters mid-edit cannot
              // silently discard what the admin was typing.
              onClick={() => { setStatusFilter(f.value); setDetailId(null) }}
              className={
                statusFilter === f.value
                  ? 'rounded-md bg-[#ECFDF5] px-3 py-1 text-xs font-semibold text-[#047857]'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary'
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {statusFilter === 'ARCHIVED' && (
          <p className="text-xs text-text-tertiary">
            Archived policies are hidden from employees. Restore one to publish it again.
          </p>
        )}
        {statusFilter === 'DRAFT' && (
          <p className="text-xs text-text-tertiary">
            Drafts are not visible to employees until they are published.
          </p>
        )}
      </div>

      <TableCard>
        <table className="hr-table [&_tbody_td]:!py-2.5">
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
              <tr><td colSpan={6} className="py-14 text-center text-sm text-text-tertiary">{EMPTY_COPY[statusFilter]}</td></tr>
            ) : policies.map((p) => (
              <React.Fragment key={p.id}>
                <tr>
                  <td className="font-semibold text-text-primary">{p.title}</td>
                  <td className="text-text-secondary">{p.category || '—'}</td>
                  <td className="text-text-secondary">{p.version || '—'}</td>
                  <td className="tabular-nums">
                    <button onClick={() => setDetailId(detailId === p.id ? null : p.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#047857] hover:text-[#064E3B]">
                      <Users size={14} /> {p.acknowledgementCount}
                    </button>
                  </td>
                  <td><HrStatusPill tone={STATUS_TONE[p.status]}>{p.status}</HrStatusPill></td>
                  <td>
                    {/* Every action here is a write the backend guards with
                        hrms.policy.write (PolicyController PUT /policies/{id},
                        POST /archive, POST /unarchive), so all three are gated
                        on the same authority rather than on the tab alone. */}
                    <div className="flex items-center justify-end gap-1">
                      {canWrite && (
                        <button onClick={() => startEdit(p)} aria-label={`Edit policy ${p.title}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]">
                          <Pencil size={14} />
                        </button>
                      )}
                      {canWrite && p.status === 'ACTIVE' && (
                        <button onClick={() => onArchive(p)} disabled={archive.isPending} aria-label={`Archive policy ${p.title}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C] disabled:opacity-50">
                          <Archive size={14} />
                        </button>
                      )}
                      {canWrite && p.status === 'ARCHIVED' && (
                        <button onClick={() => onRestore(p)} disabled={unarchive.isPending} aria-label={`Restore policy ${p.title}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#ECFDF5] hover:text-[#047857] disabled:opacity-50">
                          <ArchiveRestore size={14} />
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
