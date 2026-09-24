import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Lock, ScanFace, XCircle } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { EmptyState } from '@/shared/components/EmptyState'
import { DataTable } from '@/shared/components/DataTable'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { HrAvatar, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import {
  FACE_EVENT_LIMIT, useFaceEnrollments, useFaceEvents,
  type FacePurpose, type FaceResult, type FaceScoreBucket, type FaceVerificationEvent,
} from './useFacePunchLogs'

const PAGE_SIZE = 20

const PURPOSE_LABEL: Record<FacePurpose, string> = {
  PUNCH_IN: 'Punch in', PUNCH_OUT: 'Punch out', ENROLLMENT_SAMPLE: 'Enrollment sample', MANUAL_TEST: 'Verification test',
}
const RESULT: Record<FaceResult, { label: string; tone: PillTone }> = {
  PASS: { label: 'Verified', tone: 'ok' },
  FAIL_MATCH: { label: 'No match', tone: 'red' },
  FAIL_LIVENESS: { label: 'Liveness failed', tone: 'red' },
  FAIL_LOCKED: { label: 'Locked', tone: 'red' },
  FAIL_LOW_QUALITY: { label: 'Low quality', tone: 'warn' },
  FAIL_NO_FACE: { label: 'No face', tone: 'warn' },
  FAIL_MULTIPLE_FACES: { label: 'Multiple faces', tone: 'warn' },
  FAIL_NOT_ENROLLED: { label: 'Not enrolled', tone: 'gray' },
  FAIL_WORKER_UNAVAILABLE: { label: 'Service unavailable', tone: 'orange' },
  FAIL_OTHER: { label: 'Failed', tone: 'gray' },
}
const BUCKET: Record<FaceScoreBucket, { label: string; tone: PillTone }> = {
  HIGH: { label: 'High', tone: 'ok' }, MEDIUM: { label: 'Medium', tone: 'info' },
  LOW: { label: 'Low', tone: 'warn' }, REJECTED: { label: 'Below threshold', tone: 'red' },
  UNKNOWN: { label: 'Not scored', tone: 'gray' },
}

/**
 * Face Punch Logs tab of /hrms/attendance. Replaces the hard-coded two-row
 * stub with GET /v1/attendance/face/admin/events, gated on the permission that
 * endpoint checks (`attendance.face.admin.read`).
 *
 * What the backend does NOT give us yet — so this table does not show it:
 * no employee name/code (only the auth user id; the email comes from the
 * enrollments list), no device/location, no raw match percentage, and no date
 * or page parameters (a single newest-first window of up to 500 events, paged
 * here in the browser).
 */
export function FacePunchTab() {
  const canRead = usePermission(P.ATTENDANCE_FACE_ADMIN_READ)
  if (!canRead) {
    return (
      <div className="ut-card">
        <EmptyState icon={Lock} title="Face punch logs are restricted"
          description="Reviewing face verification events needs the face attendance admin permission. Ask an administrator for access." />
      </div>
    )
  }
  return <FacePunchLog />
}

function FacePunchLog() {
  const [employeeId, setEmployeeId] = useState('')
  const [page, setPage] = useState(0)
  const events = useFaceEvents(employeeId || undefined)
  const enrollments = useFaceEnrollments()

  const emailById = useMemo(
    () => new Map((enrollments.data ?? []).map(e => [e.employeeId, e.email ?? undefined])),
    [enrollments.data],
  )
  const rows = events.data ?? []
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  useClampedPage(page, totalPages, setPage)
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const employeeOptions = (enrollments.data ?? [])
    .map(e => ({ value: e.employeeId, label: e.email || `User ${e.employeeId.slice(0, 8)}` }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <TableCard
      filters={[{
        key: 'employee', allLabel: 'All employees', ariaLabel: 'Employee', value: employeeId,
        options: employeeOptions, hidden: employeeOptions.length === 0,
        onChange: (v) => { setEmployeeId(v); setPage(0) },
      }]}
      footer={rows.length > 0 && hrPaginationFooter({ page, pageSize: PAGE_SIZE, totalElements: rows.length, totalPages, onPageChange: setPage })}
    >
      <div className="border-b border-border-default px-5 py-4">
        <h3 className="text-lg font-semibold text-text-primary">Face Punch Logs</h3>
        <p className="mt-1 text-sm text-text-secondary">
          {events.isPending ? 'Loading face verification events…'
            : rows.length >= FACE_EVENT_LIMIT ? `Latest ${FACE_EVENT_LIMIT} face verification events, newest first — older events are not listed.`
            : `${rows.length} face verification ${rows.length === 1 ? 'event' : 'events'}, newest first.`}
        </p>
      </div>
      {events.isError ? (
        <EmptyState icon={XCircle} title="Couldn't load face punch logs"
          description={events.error instanceof Error ? events.error.message : 'The face verification log did not load.'}
          action={{ label: 'Retry', onClick: () => events.refetch() }} />
      ) : !events.isPending && rows.length === 0 ? (
        <EmptyState icon={ScanFace}
          title={employeeId ? 'No face events for this employee' : 'No face punches recorded yet'}
          description={employeeId
            ? 'This employee has no face verification attempts on record.'
            : 'Events appear here once employees enrol and punch in with face recognition on the mobile app.'} />
      ) : (
        <DataTable<FaceVerificationEvent> data={pageRows} keyField="id" loading={events.isPending}
          columns={[
            { key: 'employee', header: 'Employee', render: e => {
              const email = emailById.get(e.employeeId)
              return <HrAvatar name={email || 'Unknown user'} sub={`User ${e.employeeId.slice(0, 8)}`} />
            } },
            { key: 'purpose', header: 'Event', render: e => PURPOSE_LABEL[e.purpose] ?? e.purpose },
            { key: 'createdAt', header: 'Time', render: e => <span className="tabular-nums whitespace-nowrap">{format(new Date(e.createdAt), 'd MMM yyyy, hh:mm a')}</span> },
            { key: 'result', header: 'Result', render: e => {
              const r = RESULT[e.result] ?? { label: e.result, tone: 'gray' as PillTone }
              return <HrStatusPill tone={r.tone}>{r.label}</HrStatusPill>
            } },
            { key: 'scoreBucket', header: 'Match confidence', render: e => {
              const b = e.scoreBucket ? BUCKET[e.scoreBucket] : undefined
              return b ? <HrStatusPill tone={b.tone}>{b.label}</HrStatusPill> : <span className="text-text-tertiary">—</span>
            } },
            { key: 'reason', header: 'Reason', render: e => e.reason
              ? <span className="block max-w-[260px] truncate text-text-secondary" title={e.reason}>{e.reason}</span>
              : <span className="text-text-tertiary">—</span> },
          ]} />
      )}
    </TableCard>
  )
}
