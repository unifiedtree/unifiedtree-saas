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
import { HrButton, HrDrawer, HrStatusPill } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useUpdateWorkforceEmployee, type useWorkforceEmployee } from '../../api/useWorkforce'
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
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${done ? 'bg-[#059669]' : 'bg-gray-300'}`}
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
              actions at the top of this page.
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
        <div style={{ padding: '10px 12px', borderRadius: 12, background: '#f8fafc' }}><p className="text-xs font-semibold text-text-secondary">Reason</p><p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{emp.exitReason || 'No reason recorded.'}</p></div>
      </SubSection>}
      {canReadSettlement && (onNotice || separated) && <div className="text-sm" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '14px 16px' }}>
        <p className="font-semibold">Full &amp; final settlement</p><p className="mt-1 text-text-secondary">Review final salary, leave encashment and outstanding recoveries.</p>
        <Link to="/hrms/fnf" className="mt-3 inline-block font-semibold text-primary underline">Open full &amp; final settlements</Link>
      </div>}
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
          Still on probation — confirm or extend from the actions at the top of this page.
        </p>
      )}
    </div>
  )
}

function SeparationEditor({ emp, onClose }: { emp: Emp; onClose: () => void }) {
  const update = useUpdateWorkforceEmployee()
  const { toast } = useToast()
  const [noticeStart, setNoticeStart] = useState(emp.noticeStartDate || '')
  const [lastDay, setLastDay] = useState(emp.lastWorkingDay || '')
  const [reason, setReason] = useState(emp.exitReason || '')
  const requiresNoticeStart = emp.employmentStatus === 'NOTICE_PERIOD' || Boolean(emp.noticeStartDate)
  const invalidOrder = Boolean(noticeStart && lastDay && lastDay < noticeStart)
  const save = async () => {
    try {
      await update.mutateAsync({ id: emp.id, data: { noticeStartDate: noticeStart || undefined, lastWorkingDay: lastDay, exitReason: reason.trim() } })
      toast('Separation details saved', 'success'); onClose()
    } catch { /* Keep input visible and display the server error. */ }
  }
  return <HrDrawer title="Edit separation details" onClose={() => { if (!update.isPending) onClose() }} footer={<><HrButton variant="ghost" disabled={update.isPending} onClick={onClose}>Cancel</HrButton><HrButton disabled={!lastDay || (requiresNoticeStart && !noticeStart) || invalidOrder || update.isPending} onClick={save}>{update.isPending ? 'Saving…' : 'Save separation details'}</HrButton></>}>
    <div className="space-y-5"><p className="text-sm text-text-secondary">Correct the dates and reason recorded for this employee.</p>
      <label className="block text-sm font-medium">Notice start date<input type="date" className="ut-input mt-2" value={noticeStart} onChange={e => setNoticeStart(e.target.value)} required={requiresNoticeStart} max={lastDay || undefined} /></label>
      <label className="block text-sm font-medium">Last working day<input type="date" className="ut-input mt-2" value={lastDay} onChange={e => setLastDay(e.target.value)} required min={noticeStart || undefined} /></label>
      <div><label htmlFor="separation-reason" className="block text-sm font-medium">Separation reason</label><textarea id="separation-reason" className="ut-input mt-2" value={reason} maxLength={100} rows={3} onChange={e => setReason(e.target.value)} /></div>
      {invalidOrder && <p role="alert" className="text-sm text-danger">Last working day must be on or after the notice start date.</p>}
      {update.isError && <p role="alert" className="text-sm text-danger">{update.error instanceof Error ? update.error.message : 'Unable to update separation details.'}</p>}
    </div>
  </HrDrawer>
}
