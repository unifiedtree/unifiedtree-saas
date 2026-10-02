/**
 * Exit — where this employee stands in the joining → confirmation → exit
 * lifecycle, and the actions available from here.
 *
 * Every field comes from the employee record the page has ALREADY fetched
 * (`GET /v1/hrms/employees/{id}`) — this section issues no request of its own.
 * That is deliberate: employmentStatus, dateOfJoining, probationEndDate,
 * confirmationDate and lastWorkingDay are all on WorkforceEmployeeResponse, so
 * a second call would be pure duplication.
 *
 * The write actions are NOT reimplemented here. They stay on the page header
 * where they have always lived (confirm / extend probation / start notice /
 * cancel notice / mark exited), because those mutations own modal state and
 * cache invalidation; this section renders the state and defers to them.
 *
 * Notice dates and the reason are read from the employee detail contract.
 * Corrections update these fields without changing the employment status.
 */

import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { CalendarCheck, LogOut } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { Section, StatusPill, KeyValueGrid } from '@/design/kit/display'
import { PanelButton, SidePanel, useToast } from '@/design/kit/overlays'
import { useFnfStatus } from '../../api/shared/useFnfStatus'
import { fmtDate, inr } from './profileFormat'
import { DateField } from '@/shared/components/calendar'
import { useUpdateWorkforceEmployee, EXIT_TYPES, exitTypeLabel, type ExitType, type useWorkforceEmployee } from '../../api/useWorkforce'
import { STATUS_STYLE, PILL_TONE, SubSection } from './shared'

type Emp = NonNullable<ReturnType<typeof useWorkforceEmployee>['data']>

function fmt(d?: string) {
  if (!d) return null
  try { return format(new Date(`${d}T00:00:00`), 'd MMM yyyy') } catch { return d }
}

/** One dot on the lifecycle rail. `done` = already happened. */
function Milestone({ label, date, done, tone }: {
  label: string; date?: string | null; done: boolean; tone?: string
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: done ? 'var(--u-br,#0F6E56)' : 'var(--u-gy,#C9D2CE)' }}
      />
      <div className="min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-text-primary' : 'text-text-tertiary'}`}>
          {label}
        </p>
        <p className="text-xs text-text-secondary">{date ?? 'Not set'}</p>
        {tone && <p className="text-[11px] text-text-tertiary mt-0.5">{tone}</p>}
      </div>
    </li>
  )
}

export function EmployeeExit({ emp }: { emp: Emp }) {
  const canEdit = usePermission('hrms.employee.write')
  const canReadSettlement = usePermission('hrms.fnf.read')
  const [editing, setEditing] = useState(false)
  const status = emp.employmentStatus ?? ''
  const info = STATUS_STYLE[status] ?? { label: status || '—', tone: 'default' as const }
  const separated = status === 'EXITED' || status === 'TERMINATED'
  const onNotice = status === 'NOTICE_PERIOD'

  const joined = fmt(emp.dateOfJoining)
  const probationEnd = fmt(emp.probationEndDate)
  const confirmed = fmt(emp.confirmationDate)
  const noticeStarted = fmt(emp.noticeStartDate)
  const lastDay = fmt(emp.lastWorkingDay)

  const daysToLastDay = emp.lastWorkingDay && !separated
    ? Math.ceil((new Date(emp.lastWorkingDay).getTime() - Date.now()) / 86_400_000)
    : null

  return (
    <div className="flex flex-col gap-3">
      <SubSection title="Current standing">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <HrStatusPill tone={PILL_TONE[info.tone] ?? 'gray'}>{info.label}</HrStatusPill>
            {onNotice && lastDay && (
              <span className="text-sm text-text-secondary">
                Serving notice until <span className="font-semibold text-text-primary">{lastDay}</span>
                {daysToLastDay != null && daysToLastDay >= 0 && (
                  <> · {daysToLastDay} day{daysToLastDay === 1 ? '' : 's'} left</>
                )}
              </span>
            )}
            {separated && lastDay && (
              <span className="text-sm text-text-secondary">
                Last working day was <span className="font-semibold text-text-primary">{lastDay}</span>
              </span>
            )}
          </div>
          {!separated && !onNotice && (
            <p className="text-sm text-text-secondary">
              This employee is still employed. Notice and exit are recorded from the
              actions on the left of this page.
            </p>
          )}
        </div>
      </SubSection>

      <SubSection title="Lifecycle" hint="Dates recorded against this employment.">
        <div>
          <ol className="space-y-3">
            <Milestone label="Joined" date={joined} done={!!emp.dateOfJoining} />
            <Milestone
              label="Probation ends"
              date={probationEnd}
              done={!!emp.probationEndDate && new Date(emp.probationEndDate) <= new Date()}
            />
            <Milestone label="Confirmed" date={confirmed} done={!!emp.confirmationDate} />
            <Milestone label="Notice started" date={noticeStarted} done={!!emp.noticeStartDate} />
            <Milestone
              label={separated ? 'Exited' : 'Last working day'}
              date={lastDay}
              done={separated}
            />
          </ol>
        </div>
      </SubSection>

      {(onNotice || separated) && <SubSection title="Separation details" action={canEdit && <HrButton size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit separation details</HrButton>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <KeyValueGrid items={[
            { label: 'Notice start date', value: fmtDate(emp.noticeStartDate) },
            { label: 'Last working day', value: fmtDate(emp.lastWorkingDay) },
            { label: 'Exit type', value: exitTypeLabel(emp.exitType) },
            { label: 'Reason', value: <span style={{ whiteSpace: 'pre-wrap' }}>{emp.exitReason || 'No reason recorded.'}</span> },
          ]} />
        </div>
      </SubSection>}
      {canReadSettlement && <Settlement employeeId={emp.id} started={onNotice || separated} />}
      {editing && <SeparationEditor emp={emp} onClose={() => setEditing(false)} />}

      {separated && (
        <p className="flex items-center gap-2 text-xs text-text-tertiary">
          <LogOut size={12} />
          Exited employees stay in the directory; they are excluded from active-roster counts.
        </p>
      )}
      {!separated && !emp.confirmationDate && emp.probationEndDate && (
        <p className="flex items-center gap-2 text-xs text-text-tertiary">
          <CalendarCheck size={12} />
          Still on probation — confirm or extend from the actions on the left of this page.
        </p>
      )}
    </div>
  )
}

function SeparationEditor({ emp, onClose }: { emp: Emp; onClose: () => void }) {
  const update = useUpdateWorkforceEmployee()
  const toast = useToast()
  const [noticeStart, setNoticeStart] = useState(emp.noticeStartDate || '')
  const [lastDay, setLastDay] = useState(emp.lastWorkingDay || '')
  const [reason, setReason] = useState(emp.exitReason || '')
  const [exitType, setExitType] = useState<ExitType | ''>(emp.exitType || '')
  const requiresNoticeStart = emp.employmentStatus === 'NOTICE_PERIOD' || Boolean(emp.noticeStartDate)
  const invalidOrder = Boolean(noticeStart && lastDay && lastDay < noticeStart)
  const save = async () => {
    try {
      await update.mutateAsync({ id: emp.id, data: { noticeStartDate: noticeStart || undefined, lastWorkingDay: lastDay, exitReason: reason.trim(), exitType: exitType || undefined } })
      toast.success('Separation details saved'); onClose()
    } catch { /* Keep input visible and display the server error. */ }
  }
  const blocked = !lastDay ? 'Choose the last working day' : requiresNoticeStart && !noticeStart ? 'Choose the notice start date' : invalidOrder ? 'Last working day must be on or after the notice start date' : null
  return <SidePanel open title="Edit separation details" sub="Correct the dates, exit type and reason recorded for this employee." closeLabel="Close panel" busy={update.isPending} onClose={onClose}
    footer={<><PanelButton size="lg" onClick={onClose}>Cancel</PanelButton><PanelButton size="lg" variant="primary" busy={update.isPending} blockedReason={blocked} onClick={() => void save()}>Save separation details</PanelButton></>}>
    <div className="space-y-5">
      <label className="block text-sm font-medium">Exit type<select className="ut-select mt-2" value={exitType} onChange={e => setExitType(e.target.value as ExitType)}>
        {!exitType && <option value="">Not recorded</option>}
        {EXIT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select><span className="mt-1 block text-xs font-normal text-text-secondary">The attrition report counts this exit as resigned, terminated or other from it.</span></label>
      <label className="block text-sm font-medium">Notice start date<DateField aria-label="Notice start date" className="ut-input mt-2" value={noticeStart} onChange={e => setNoticeStart(e.target.value)} required={requiresNoticeStart} max={lastDay || undefined} clearable={!requiresNoticeStart} /></label>
      <label className="block text-sm font-medium">Last working day<DateField aria-label="Last working day" className="ut-input mt-2" value={lastDay} onChange={e => setLastDay(e.target.value)} required min={noticeStart || undefined} /></label>
      <div><label htmlFor="separation-reason" className="block text-sm font-medium">Separation reason</label><textarea id="separation-reason" className="ut-input mt-2" value={reason} maxLength={100} rows={3} onChange={e => setReason(e.target.value)} /></div>
      {invalidOrder && <p role="alert" className="text-sm text-danger">Last working day must be on or after the notice start date.</p>}
      {update.isError && <p role="alert" className="text-sm text-danger">{update.error instanceof Error ? update.error.message : 'Unable to update separation details.'}</p>}
    </div>
  </SidePanel>
}

const FNF_LABEL: Record<string, [string, 'brand' | 'warning' | 'success' | 'neutral']> = {
  INITIATED: ['Initiated', 'neutral'], PROCESSED: ['Waiting for approval', 'warning'], APPROVED: ['Waiting for payment', 'brand'], PAID: ['Paid', 'success'], CANCELLED: ['Cancelled', 'neutral'],
}

/** Full & final settlement for this person (BW-64, hrms.fnf.read): its state, or that it hasn't started. */
function Settlement({ employeeId, started }: { employeeId: string; started: boolean }) {
  const q = useFnfStatus([employeeId])
  const row = q.data?.find((r) => r.employeeId === employeeId)
  const [label, tone] = row?.status ? FNF_LABEL[row.status] ?? [row.status, 'neutral' as const] : ['Not started', 'neutral' as const]
  return (
    <Section title="Full & final settlement" variant="section" loading={q.isLoading} error={q.notAvailable ? undefined : q.error} onRetry={() => void q.refetch()} skeleton="text"
      actions={<Link to="/hrms/fnf" className="text-sm font-medium" style={{ color: 'var(--u-brt,#0F6E56)' }}>Open full &amp; final settlements</Link>}>
      {!row?.settlementId ? (
        <p className="upf-note">{started ? 'Not started yet. Review final salary, leave encashment and outstanding recoveries.' : 'Starts once a last working day is set.'}</p>
      ) : (
        <KeyValueGrid items={[
          { label: 'Status', value: <StatusPill tone={tone} dot>{label}</StatusPill> },
          { label: 'Last working day', value: fmtDate(row.lastWorkingDay) },
          { label: 'Net settlement', value: inr(row.netSettlement) },
          { label: 'Paid', value: row.paidAt ? fmtDate(row.paidAt) : 'Not yet' },
        ]} />
      )}
    </Section>
  )
}
