// "Mark attendance" for several people at once (BW-17): one day, the same times, status and reason
// for everyone picked. POST /v1/attendance/manual-entry/bulk (attendance.workforce.admin) saves
// them in one go and answers per person: saved, or skipped with the reason (already has a punch
// that day, not found, yourself). Each saved day is a manual entry in the audit log, as a single
// manual entry is. Absent isn't offered: an absence is a status change (Review), not a punch.
import { useMemo, useState } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { Callout, StatusPill } from '@/design/kit/display'
import { Checkbox, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { fmtWd } from '@/design/dc/dates'
import type { AttendanceDto } from '../../api/useAttendance'
import type { LogRow } from './DailyLogs'

/** The four ways a day can be marked here, as the manual entry page offers them (E7). */
export const MARK_AS: { value: string; label: string; type: string; status?: string }[] = [
  { value: 'PRESENT', label: 'Present', type: 'OFFICE' },
  { value: 'HALF_DAY', label: 'Half day', type: 'OFFICE', status: 'HALF_DAY' },
  { value: 'WFH', label: 'Work from home', type: 'WFH' },
  { value: 'ON_DUTY', label: 'On duty (out of office)', type: 'FIELD_WORK' },
]

/** yyyy-MM-dd + HH:mm in IST → the instant the API takes. */
export const istInstant = (date: string, hhmm: string) => (hhmm ? new Date(`${date}T${hhmm}:00+05:30`).toISOString() : undefined)

interface BulkResult { saved: number; skipped: number; results: { employeeId: string; employeeName: string | null; outcome: 'SAVED' | 'SKIPPED'; code: string | null; message: string | null; attendance: AttendanceDto | null }[] }

export function BulkMarkPanel({ date, rows, picked, onClose, onDone }: {
  date: string; rows: LogRow[]; picked: string[]; onClose: () => void; onDone: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [ids, setIds] = useState<string[]>(picked)
  const [q, setQ] = useState('')
  const [as, setAs] = useState('PRESENT')
  const [inAt, setIn] = useState('09:30')
  const [outAt, setOut] = useState('18:30')
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)
  const choice = MARK_AS.find((m) => m.value === as) || MARK_AS[0]
  // Only people without a punch that day can be marked; the rest would be skipped anyway.
  const open = useMemo(() => rows.filter((r) => !r.inAt), [rows])
  const shown = open.filter((r) => !q.trim() || `${r.name} ${r.code}`.toLowerCase().includes(q.trim().toLowerCase()))
  const save = useMutation({
    mutationFn: () => apiJson<BulkResult>('/v1/attendance/manual-entry/bulk', {
      method: 'POST',
      body: JSON.stringify({
        attendanceDate: date, checkInAt: istInstant(date, inAt), checkOutAt: istInstant(date, outAt),
        attendanceType: choice.type, ...(choice.status ? { attendanceStatus: choice.status } : {}), reason: reason.trim(), employeeIds: ids,
      }),
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] })
      qc.invalidateQueries({ queryKey: ['attendance'] })
      setResult(r)
      if (r.skipped === 0) { toast.success(`Marked ${r.saved} ${r.saved === 1 ? 'person' : 'people'} ${choice.label.toLowerCase()} for ${fmtWd(date)}`); onDone() }
    },
    onError: (e) => toast.error('Couldn’t mark attendance', { detail: (e as Error)?.message }),
  })
  const problems = {
    people: ids.length === 0 ? 'Pick at least one person.' : ids.length > 200 ? 'Mark at most 200 people at a time.' : null,
    time: !inAt && !outAt ? 'Enter a check-in, a check-out, or both.' : inAt && outAt && outAt <= inAt ? 'The check-out must be after the check-in.' : null,
    reason: reason.trim().length < 3 ? 'Add a reason (at least 3 characters). It’s kept with each day.' : null,
  }
  const blocked = problems.people || problems.time || problems.reason
  const toggle = (id: string, on: boolean) => setIds((cur) => (on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)))

  return (
    <SidePanel open onClose={onClose} title="Mark attendance" sub={`${fmtWd(date)} · the same times and reason for everyone you pick`}
      busy={save.isPending}
      footer={result && result.skipped > 0 ? <PanelButton size="lg" variant="primary" onClick={onDone}>Done</PanelButton> : (
        <>
          <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
          <PanelButton size="lg" variant="primary" busy={save.isPending} blockedReason={blocked} tipAlign="end"
            onBlockedClick={() => setTried(true)} onClick={() => { setTried(true); if (!blocked) save.mutate() }}>
            {`Mark ${ids.length || ''} ${ids.length === 1 ? 'person' : 'people'}`.replace('  ', ' ')}
          </PanelButton>
        </>
      )}>
      {result ? (
        <div className="udt-bulk-result">
          <Callout tone={result.skipped ? 'warning' : 'success'} live>
            {`${result.saved} marked · ${result.skipped} skipped.`}
          </Callout>
          <ul className="udt-bulk-list">
            {result.results.map((r) => (
              <li key={r.employeeId}>
                <span>{r.employeeName || 'Employee'}</span>
                {r.outcome === 'SAVED' ? <StatusPill tone="success" size="xs">Marked</StatusPill> : <span className="udt-q">{r.message || 'Skipped'}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="udt-bulk">
          <FieldGrid columns={2}>
            <Select label="Mark as" value={as} onChange={(e) => setAs(e.target.value)} options={MARK_AS.map((m) => ({ value: m.value, label: m.label }))} full />
            <Input label="Came in" type="time" value={inAt} onChange={(e) => setIn(e.target.value)} />
            <Input label="Went out" type="time" value={outAt} onChange={(e) => setOut(e.target.value)} error={tried ? problems.time : undefined} />
            <Textarea label="Reason" required full rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Biometric device was down; all were in the office." error={tried ? problems.reason : undefined} />
          </FieldGrid>
          <div className="udt-bulk-people">
            <div className="udt-bulk-head">
              <span className="udt-bulk-title">People <StatusPill tone="brand" size="xs">{ids.length} picked</StatusPill></span>
              <span className="udt-q">Only people without a punch that day</span>
            </div>
            <Input aria-label="Find a person" placeholder="Find a person or code" value={q} onChange={(e) => setQ(e.target.value)} leading="search" />
            {tried && problems.people && <Callout tone="danger">{problems.people}</Callout>}
            <ul className="udt-bulk-list" aria-label="People without a punch">
              {shown.length === 0 && <li className="udt-q">{open.length ? 'No one matches.' : 'Everyone on the roster has a punch that day.'}</li>}
              {shown.map((r) => (
                <li key={r.id}>
                  <Checkbox checked={ids.includes(r.id)} onChange={(on) => toggle(r.id, on)} label={r.name} description={`${r.code}${r.dept !== '—' ? ' · ' + r.dept : ''}`} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </SidePanel>
  )
}
