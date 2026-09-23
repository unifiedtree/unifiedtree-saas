import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrPagination } from '@/shared/components/HrPagination'
import { HrAvatar, HrButton, HrStatusPill } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useCorrectionApprovals, useDecideCorrection } from '../api/useAttendance'

const requestedTime = (value?: string) => value
  ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : 'No change requested'

export function CorrectionApprovals() {
  const [status, setStatus] = useState('PENDING')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [comments, setComments] = useState<Record<string, string>>({})
  const query = useCorrectionApprovals(status, { page, size })
  const decide = useDecideCorrection()
  const canReadEmployee = usePermission(P.HRMS_EMPLOYEE_READ)
  const { toast } = useToast()
  const rows = query.data?.content ?? []
  useEffect(() => {
    if (query.data && page > 0 && page >= query.data.totalPages) setPage(Math.max(0, query.data.totalPages - 1))
  }, [query.data, page])

  async function submit(id: string, approved: boolean) {
    try {
      await decide.mutateAsync({ id, status: approved ? 'APPROVED' : 'REJECTED', comment: comments[id]?.trim() || undefined })
      toast(approved ? 'Attendance correction approved' : 'Attendance correction rejected', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to save the decision. Please try again.', 'error')
    }
  }

  return <section className="ut-card overflow-hidden" aria-label="Attendance correction approvals">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-default p-5">
      <div><h3 className="text-base font-semibold text-text-primary">Attendance requests</h3>
        <p className="mt-1 text-sm text-text-secondary">Review who requested a correction and the times they want changed. Times are IST.</p></div>
      <label className="text-sm text-text-secondary">Status
        <select className="ut-input ml-2 !w-auto" value={status} onChange={e => { setStatus(e.target.value); setPage(0) }}>
          <option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
        </select>
      </label>
    </div>
    {query.isLoading ? <p className="p-8 text-text-secondary" role="status">Loading attendance requests…</p>
      : query.isError ? <div className="p-8" role="alert"><p>Attendance requests could not be loaded.</p><HrButton className="mt-3" onClick={() => query.refetch()}>Try again</HrButton></div>
      : rows.length === 0 ? <p className="p-10 text-center text-text-secondary">No {status.toLowerCase()} attendance requests.</p>
      : <div className="divide-y divide-border-default">{rows.map(request => <article key={request.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3"><HrAvatar name={request.employeeName || request.employeeCode || 'Employee'} />
            <div>{canReadEmployee ? <Link className="font-semibold text-primary hover:underline" to={`/hrms/employees/${request.employeeId}`}>{request.employeeName || request.employeeCode || 'View employee'}</Link>
              : <p className="font-semibold">{request.employeeName || request.employeeCode || 'Employee details unavailable'}</p>}
              <p className="mt-1 text-xs text-text-secondary">{[request.employeeCode, request.departmentName].filter(Boolean).join(' · ') || 'Department unavailable'}</p>
            </div>
          </div><HrStatusPill tone={request.status === 'APPROVED' ? 'ok' : request.status === 'REJECTED' ? 'red' : 'warn'}>{request.status}</HrStatusPill>
        </div>
        <dl className="my-4 grid gap-4 rounded-lg bg-bg-base p-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-text-secondary">Attendance date</dt><dd className="mt-1 font-medium">{request.requestedDate}</dd></div>
          <div><dt className="text-xs text-text-secondary">Requested check-in</dt><dd className="mt-1 font-medium">{requestedTime(request.requestedCheckInAt)}</dd></div>
          <div><dt className="text-xs text-text-secondary">Requested check-out</dt><dd className="mt-1 font-medium">{requestedTime(request.requestedCheckOutAt)}</dd></div>
        </dl>
        <p className="whitespace-pre-wrap text-sm text-text-primary"><span className="font-semibold">Reason: </span>{request.reason}</p>
        {request.attachmentUrl && /^https?:\/\//i.test(request.attachmentUrl) && <a href={request.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-primary underline">View attachment</a>}
        {request.status === 'PENDING' ? <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 text-xs text-text-secondary">Decision note (optional)
            <input className="ut-input mt-1" maxLength={1000} value={comments[request.id] ?? ''} onChange={e => setComments(prev => ({ ...prev, [request.id]: e.target.value }))} placeholder="Explain your decision" />
          </label>
          <HrButton disabled={decide.isPending || query.isFetching} onClick={() => submit(request.id, false)} variant="ghost">Reject</HrButton>
          <HrButton disabled={decide.isPending || query.isFetching} onClick={() => submit(request.id, true)}>Approve</HrButton>
        </div> : request.approverComment && <p className="mt-3 text-sm text-text-secondary">Decision note: {request.approverComment}</p>}
      </article>)}</div>}
    {query.data && !query.isError && <HrPagination page={page} pageSize={size} totalElements={query.data.totalElements} totalPages={query.data.totalPages} onPageChange={setPage} onPageSizeChange={next => { setSize(next); setPage(0) }} />}
  </section>
}
