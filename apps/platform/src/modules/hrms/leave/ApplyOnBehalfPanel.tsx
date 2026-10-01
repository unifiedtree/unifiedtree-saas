// Apply for leave on an employee's behalf (BW-43 · hrms.leave.apply.others).
// The design's primary button on the Leave operations center opens this: an
// employee picker, the same leave form the employee would see, and the live
// preview from BW-48 so HR sees exactly what will be filed (approver, days,
// balance after, every blocking reason). The employee is notified, and the
// request goes through their normal approver chain.
import { useMemo, useState } from 'react'
import { Button } from '@/design/kit/display'
import { SidePanel, Dropdown, FormField, Select, Textarea, DateInput, useToast } from '@/design/kit/overlays'
import { useApplyLeaveOnBehalf } from '../api/shared/useApplyLeaveOnBehalf'
import { useEmployeeDirectory } from '../api/useWorkforce'
import { useEmployeeLeaveBalances, useLeaveTypes, useLeavePreview, type LeaveDuration } from '../api/useLeave'
import { useCompanies } from '../api/useOrg'
import { days, todayIso } from '@/design/module/ModuleKit'

const REASON_MAX = 500

interface Props { open: boolean; onClose: () => void; onDone?: () => void }

export function ApplyOnBehalfPanel({ open, onClose, onDone }: Props) {
  const toast = useToast()
  const [picked, setPicked] = useState<string>('')
  const [f, setF] = useState<{ leaveTypeId: string; startDate: string; endDate: string; duration: LeaveDuration; reason: string }>({
    leaveTypeId: '', startDate: '', endDate: '', duration: 'FULL_DAY', reason: '',
  })

  // The directory call pages 50 at a time; Dropdown's own search filters this
  // list client-side. Only run while open.
  const dir = useEmployeeDirectory({ status: 'ACTIVE', pageSize: 50, page: 0 }, { enabled: open })
  const options = useMemo(() => {
    const rows = dir.data?.content ?? []
    return rows.map((e) => ({
      value: e.id,
      label: `${e.firstName}${e.lastName ? ` ${e.lastName}` : ''}`,
      sub: [e.employeeCode, e.email].filter(Boolean).join(' · '),
      monogram: (e.firstName.charAt(0) + (e.lastName?.charAt(0) || '')).toUpperCase(),
      keywords: `${e.employeeCode ?? ''} ${e.email ?? ''}`,
    }))
  }, [dir.data])

  const { data: companies = [] } = useCompanies()
  const chosen = (dir.data?.content ?? []).find((e) => e.id === picked)
  const companyId = chosen?.companyId ?? companies[0]?.id ?? ''
  const types = useLeaveTypes(companyId)
  const bal = useEmployeeLeaveBalances(picked, new Date().getFullYear(), !!picked)
  const active = (types.data ?? []).filter((t) => t.isActive)

  const half = f.duration !== 'FULL_DAY'
  const end = half ? f.startDate : f.endDate
  const preview = useLeavePreview(
    { leaveTypeId: f.leaveTypeId, startDate: f.startDate, endDate: end, duration: f.duration, companyId },
    !!picked,
  )

  const apply = useApplyLeaveOnBehalf()
  const problem = !picked ? 'Choose an employee.'
    : !f.leaveTypeId ? 'Choose a leave type.'
      : !f.startDate ? 'Pick a start date.'
        : !end ? 'Pick an end date.'
          : end < f.startDate ? 'The end date must be on or after the start date.'
            : f.reason.trim().length < 10 ? 'Add a reason (10+ characters).' : null
  const refusal = preview.data?.blockingReasons?.[0]
  const blocking = problem || refusal?.message || null
  const busy = apply.isPending

  const submit = async () => {
    if (blocking || busy || !picked) return
    try {
      const result = await apply.mutateAsync({
        employeeId: picked,
        leaveTypeId: f.leaveTypeId,
        startDate: f.startDate,
        endDate: end,
        duration: f.duration,
        reason: f.reason.trim(),
      })
      if (!result.available) {
        toast.error('Apply on behalf isn’t switched on yet', { detail: 'Ask the lead to enable it.' })
        return
      }
      toast.success(`Leave filed for ${chosen?.firstName ?? 'the employee'}`,
        { detail: 'They’ve been told and their approver was notified.' })
      setPicked('')
      setF({ leaveTypeId: '', startDate: '', endDate: '', duration: 'FULL_DAY', reason: '' })
      onDone?.()
      onClose()
    } catch (e) {
      toast.error('Couldn’t file the leave', { detail: e instanceof Error ? e.message : undefined })
    }
  }

  const summary = preview.data
  return (
    <SidePanel
      open={open}
      onClose={() => { if (!busy) onClose() }}
      title="Apply leave on behalf"
      sub="File a request in another employee’s name. They’re notified, and it still goes through their approver."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => { if (!busy) onClose() }}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!!blocking || busy}>
            {busy ? 'Filing…' : 'File leave'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--u-ink2,#4A5A54)' }}>
            Employee <span aria-hidden="true" style={{ color: 'var(--u-rdt,#B42318)' }}>*</span>
          </span>
          <Dropdown
            label="Employee"
            value={picked || null}
            options={options}
            onChange={(v) => setPicked(v)}
            placeholder={dir.isLoading ? 'Loading…' : 'Search by name, code or email'}
            searchable
            emptyText={dir.error ? 'Couldn’t load the directory.' : 'No one matches.'}
          />
        </div>
        <FormField label="Leave type" required>
          <Select value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}
            disabled={!picked || types.isLoading}
            options={[
              { value: '', label: types.isLoading ? 'Loading…' : 'Choose a leave type' },
              ...active.map((t) => {
                const b = (bal.data ?? []).find((x) => x.leaveTypeId === t.id)
                return { value: t.id, label: b ? `${t.name} · ${days(b.available)} left` : t.name }
              }),
            ]} />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 12 }}>
          <FormField label="From" required>
            <DateInput min={todayIso()} value={f.startDate}
              onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </FormField>
          <FormField label="To" required>
            <DateInput min={f.startDate || todayIso()} disabled={half} value={end}
              onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Duration">
          <Select value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value as LeaveDuration })} options={[
            { value: 'FULL_DAY', label: 'Full days' },
            { value: 'HALF_DAY_MORNING', label: 'Half day · morning' },
            { value: 'HALF_DAY_AFTERNOON', label: 'Half day · afternoon' },
          ]} />
        </FormField>
        <FormField label="Reason" required hint={`${f.reason.length}/${REASON_MAX}`}>
          <Textarea rows={3} maxLength={REASON_MAX} value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            placeholder="At least 10 characters, so the approver has context." />
        </FormField>

        {summary && !refusal && typeof summary.workingDays === 'number' && summary.workingDays > 0 && (
          <aside aria-label="Preview" className="umk-note uk-tone--neutral" style={{ display: 'grid', gap: 4 }}>
            <strong style={{ fontSize: 13 }}>
              {days(summary.workingDays)}{summary.leaveTypeName ? ` of ${summary.leaveTypeName}` : ''}
            </strong>
            <span style={{ fontSize: 12.5, color: 'var(--u-ink2,#4A5A54)' }}>
              {summary.approverName ? `Approver: ${summary.approverName}.` : 'Approver not resolved yet.'}
              {typeof summary.balanceAfter === 'number' && typeof summary.balanceAvailable === 'number'
                ? ` Balance after: ${days(summary.balanceAfter)} of ${days(summary.balanceAvailable)}.`
                : ''}
            </span>
          </aside>
        )}
        {refusal && (
          <p role="alert" className="umk-note uk-tone--danger">{refusal.message}</p>
        )}
      </div>
    </SidePanel>
  )
}
