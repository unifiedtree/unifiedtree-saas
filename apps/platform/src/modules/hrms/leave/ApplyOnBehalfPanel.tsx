// Apply for leave on an employee's behalf (BW-43 · hrms.leave.apply.others).
// The design's primary button on the Leave operations center opens this: an
// employee picker, the same leave form the employee would see, and the live
// preview from BW-48 so HR sees exactly what will be filed (approver, days,
// balance after, every blocking reason). The employee is notified, and the
// request goes through their normal approver chain.
import { useMemo, useState } from 'react'
import { Button } from '@/design/kit/display'
import { SidePanel, Dropdown, FormField, Select, Textarea, useToast } from '@/design/kit/overlays'
import { DateRangeButton, DateRangeDialog, type PickedDates, type RangeEnd } from '@/design/kit/DateRangePicker'
import { useApplyLeaveOnBehalf } from '../api/shared/useApplyLeaveOnBehalf'
import { isCurrentStaff, useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { useEmployeeLeaveBalances, useLeaveTypes, useLeavePreview, type LeaveDuration } from '../api/useLeave'
import { useCurrentCompany } from '../company/CurrentCompany'
import { useHolidays, useWeekendDays, jsWeekendDays } from '../api/useSettings'
import { days, todayIso } from '@/design/module/ModuleKit'

const REASON_MAX = 500

interface Props { open: boolean; onClose: () => void; onDone?: () => void }

export function ApplyOnBehalfPanel({ open, onClose, onDone }: Props) {
  const toast = useToast()
  const [picked, setPicked] = useState<string>('')
  // The chosen person, kept while a later search no longer lists them.
  const [chosen, setChosen] = useState<WorkforceEmployee | null>(null)
  const [search, setSearch] = useState('')
  const typed = useDebounce(search.trim(), 300)
  const [f, setF] = useState<{ leaveTypeId: string; startDate: string; endDate: string; duration: LeaveDuration; reason: string }>({
    leaveTypeId: '', startDate: '', endDate: '', duration: 'FULL_DAY', reason: '',
  })

  // The people of the company the top bar is on who still work there (probation and notice period
  // too; not leavers). The typed search goes to the server, 50 at a time. Only run while open.
  const { companyId: currentCompanyId } = useCurrentCompany()
  const dir = useEmployeeDirectory({ search: typed || undefined, pageSize: 50, page: 0, companyId: currentCompanyId || undefined }, { enabled: open })
  const options = useMemo(() => {
    const rows = (dir.data?.content ?? []).filter(isCurrentStaff)
    if (chosen && !rows.some((e) => e.id === chosen.id)) rows.unshift(chosen)
    return rows.map((e) => ({
      value: e.id,
      label: `${e.firstName}${e.lastName ? ` ${e.lastName}` : ''}`,
      sub: [e.employeeCode, e.email].filter(Boolean).join(' · '),
      monogram: (e.firstName.charAt(0) + (e.lastName?.charAt(0) || '')).toUpperCase(),
      keywords: `${e.employeeCode ?? ''} ${e.email ?? ''}`,
    }))
  }, [dir.data, chosen])

  const companyId = chosen?.companyId ?? currentCompanyId
  const types = useLeaveTypes(companyId)
  const bal = useEmployeeLeaveBalances(picked, new Date().getFullYear(), !!picked)
  const active = (types.data ?? []).filter((t) => t.isActive)

  const half = f.duration !== 'FULL_DAY'
  const end = half ? f.startDate : f.endDate
  const preview = useLeavePreview(
    { leaveTypeId: f.leaveTypeId, startDate: f.startDate, endDate: end, duration: f.duration, companyId },
    !!picked,
  )

  // "Select dates": the company's weekly offs and holidays, as the server counts leave.
  const [picking, setPicking] = useState(false)
  // The box that opened the picker: a tap from "To" moves the end, from "From" the start.
  const [pickFrom, setPickFrom] = useState<RangeEnd>('from')
  const [draft, setDraft] = useState<PickedDates | null>(null)
  const today = todayIso()
  const wk = useWeekendDays(open && companyId ? companyId : undefined)
  const hols = useHolidays(open ? companyId : '', Number(today.slice(0, 4)))
  const holsNext = useHolidays(open ? companyId : '', Number(today.slice(0, 4)) + 1)
  const cal = useMemo(() => ({
    off: jsWeekendDays(wk.data?.weekendDays),
    holidays: new Map([...(hols.data ?? []), ...(holsNext.data ?? [])].filter((h) => h.active !== false).map((h) => [h.holidayDate.slice(0, 10), h.holidayName] as const)),
  }), [wk.data, hols.data, holsNext.data])
  const draftDuration: LeaveDuration = draft?.halfDay ? (f.duration === 'HALF_DAY_AFTERNOON' ? 'HALF_DAY_AFTERNOON' : 'HALF_DAY_MORNING') : 'FULL_DAY'
  const draftPreview = useLeavePreview(
    { leaveTypeId: f.leaveTypeId, startDate: draft?.from, endDate: draft?.to, duration: draftDuration, companyId },
    picking && !!picked,
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
      setChosen(null)
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
            onChange={(v) => { setPicked(v); setChosen((dir.data?.content ?? []).find((e) => e.id === v) ?? null) }}
            placeholder={dir.isLoading ? 'Loading…' : 'Search by name, code or email'}
            searchable
            onSearch={setSearch}
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
        <DateRangeButton from={f.startDate} to={end} startLabel="From *" endLabel="To *" endDisabled={half} onOpen={(box) => { setPickFrom(box); setPicking(true) }} />
        <DateRangeDialog open={picking} onClose={() => setPicking(false)} from={f.startDate} to={end} openedFrom={pickFrom} min={today} calendar={cal}
          halfDay={half} noun="leave" onDraftChange={setDraft} serverDays={draftPreview.data?.workingDays ?? null}
          onDone={(r) => {
            setF({ ...f, startDate: r.from, endDate: r.to, duration: r.halfDay ? (half ? f.duration : 'HALF_DAY_MORNING') : 'FULL_DAY' })
            setPicking(false)
          }} />
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
