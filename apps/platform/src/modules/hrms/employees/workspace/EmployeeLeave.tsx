/**
 * Leave — this employee's balances for the year and their leave requests.
 *
 * Reads the per-employee endpoints added for this tab (V143.13):
 *   GET /v1/leave/employees/{id}/balances   (the India calendar year)
 *   GET /v1/leave/employees/{id}/requests   (newest first, paged)
 * HR / admin (hrms.leave.employee.read) see anyone, department managers their
 * team (the My team page's team), everyone else only themselves. A 403 renders
 * as a no-access state, never as "no leave".
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Plane } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import { usePersonalPages } from '@/shared/hooks/usePersonalPages'
import { Button } from '@/design/kit/display'
import { HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { Facts, range } from '@/design/module/ModuleKit'
import { istToday } from '@/design/dc/dates'
import { RangeFilter, useRangeParam } from '@/design/kit/RangeFilter'
import { LIST_MAX_DAYS } from '../../api/shared/listRange'
import { useEmployeeLeaveBalances, useEmployeeLeaveRequests, type LeaveApprovalStatus } from '../../api/useLeave'
import { SectionState, SubSection } from './shared'
import { ApplyLeaveForPanel } from './OnBehalfPanels'

// PENDING is with whoever the request was routed to, not always a manager (no
// manager: the department head, else HR; audit 5 Oct 2026), so the pill says
// "Waiting for approval" and the line under it names the approver.
const STATUS: Record<LeaveApprovalStatus, [string, PillTone]> = {
  PENDING: ['Waiting for approval', 'warn'], PENDING_L2: ['Waiting for HR', 'warn'],
  APPROVED: ['Approved', 'ok'], REJECTED: ['Rejected', 'red'], CANCELLED: ['Cancelled', 'gray'],
}
const PAGE_SIZE = 10
// A figure the server left out shows a dash instead of throwing.
const n = (d?: number | null) => (d == null || !Number.isFinite(d) ? '—' : Number.isInteger(d) ? String(d) : d.toFixed(1))
/** An instant as the viewer's calendar day (India for our users), never the UTC date. */
const onDay = (at?: string) => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export function EmployeeLeave({ employeeId, firstName, companyId, name, self }: { employeeId: string; firstName: string; companyId?: string; name?: string; self?: boolean }) {
  const navigate = useNavigate()
  const canDecide = usePermission('hrms.leave.approve.l1')
  // Apply on behalf (BW-43): never for yourself (that is your own request, from Leave).
  const canOthers = usePermission(P.HRMS_LEAVE_APPLY_OTHERS) && !self && !!companyId
  const [onBehalf, setOnBehalf] = useState(false)
  // Your own leave opens My leave, which by default owners and admins don't have (the personal pages rule, usePersonalPages: the owner sets it per role).
  const personal = usePersonalPages()
  const canApplySelf = usePermission('leave.request.self') && personal
  const year = Number(istToday().slice(0, 4))
  const [page, setPage] = useState(0)
  // The start / end calendar (?from=&to=): the server keeps the requests to leave whose days fall in it.
  const [dates, setDates] = useRangeParam({ maxSpan: LIST_MAX_DAYS })
  const balances = useEmployeeLeaveBalances(employeeId, year)
  const requests = useEmployeeLeaveRequests(employeeId, page, PAGE_SIZE, true, dates)
  useClampedPage(page, requests.data?.totalPages, setPage)
  const rows = requests.data?.content ?? []
  const bal = balances.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <SubSection title={`Balances · ${year}`} hint="Available after pending requests"
        action={canOthers ? <Button size={30} variant="secondary" icon="plus" onClick={() => setOnBehalf(true)}>Apply on behalf</Button>
          : self && canApplySelf ? <Button size={30} variant="secondary" icon="plus" onClick={() => navigate('/hrms/leave?tab=my')}>Apply leave</Button> : undefined}>
        <SectionState
          isLoading={balances.isLoading} error={balances.error} onRetry={() => balances.refetch()}
          isEmpty={!balances.isLoading && !balances.error && bal.length === 0}
          emptyIcon={CalendarDays} emptyTitle="No leave allocated"
          emptyHint="No active leave types apply to this employee's company yet. Leave types are set up under Master data."
          forbiddenTitle="You can't see this person's leave"
          forbiddenHint="Managers see their own team's leave; HR and admins see everyone's."
        >
          <Facts min={170} items={bal.map((b) => ({
            k: b.leaveTypeName || 'Leave',
            v: <>
              {`${n(b.available)} of ${n(b.totalEntitlement + (b.carryForward || 0))}`}
              <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--u-ink3,#6A7A73)', marginTop: 2 }}>
                {`${n(b.used)} used · ${n(b.pending)} pending · ${n(b.totalEntitlement + (b.carryForward || 0))} total`}
              </span>
            </>,
          }))} />
        </SectionState>
      </SubSection>

      <SubSection title="Leave requests" hint="Newest first, with where each one stands."
        action={<div className="flex flex-wrap items-center justify-end gap-2">
          {!requests.error && <RangeFilter value={dates} onChange={(r) => { setDates(r); setPage(0) }} maxSpan={LIST_MAX_DAYS} label="Leave dates" filterKey="employee-leave-dates" align="end" />}
          {canDecide && <HrButton size="sm" variant="ghost" onClick={() => navigate('/hrms/leave')}>Open Leave centre</HrButton>}
        </div>}>
        <SectionState
          isLoading={requests.isLoading} error={requests.error} onRetry={() => requests.refetch()}
          isEmpty={!requests.isLoading && !requests.error && rows.length === 0}
          emptyIcon={Plane} emptyTitle={dates ? 'No leave on these dates' : 'No leave requests yet'}
          emptyHint={dates ? 'Pick other dates, or clear them to see every request.' : `Requests ${firstName} makes appear here with their status.`}
          forbiddenTitle="You can't see this person's leave"
          forbiddenHint="Managers see their own team's leave; HR and admins see everyone's."
        >
          <TableCard footer={(requests.data?.totalPages ?? 0) > 1 ? hrPaginationFooter({ page, pageSize: PAGE_SIZE, totalElements: requests.data?.totalElements ?? 0, totalPages: requests.data?.totalPages ?? 0, onPageChange: setPage }) : undefined}>
            <table className="hr-table">
              <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th className="hidden md:table-cell">Reason</th><th className="hidden sm:table-cell">Applied</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const st = STATUS[r.status] ?? [r.status, 'gray' as PillTone]
                  return (
                    <tr key={r.id}>
                      <td className="font-medium text-text-primary">{r.leaveTypeName || 'Leave'}</td>
                      <td className="whitespace-nowrap text-text-secondary">{range(r.startDate, r.endDate)}</td>
                      <td className="text-text-secondary">{n(r.totalDays)}</td>
                      <td>
                        <HrStatusPill tone={st[1]}>{st[0]}</HrStatusPill>
                        {r.status === 'PENDING' && r.approverName && r.approverName !== name && <span className="mt-1 block text-xs text-text-secondary">With {r.approverName}</span>}
                        {r.status === 'REJECTED' && r.approverComment && <span className="mt-1 block text-xs" style={{ color: 'var(--u-rdt,#B42318)' }}>{r.approverComment}</span>}
                      </td>
                      <td className="hidden md:table-cell"><span className="block max-w-xs truncate text-text-secondary" title={r.reason || undefined}>{r.reason || '—'}</span></td>
                      <td className="hidden sm:table-cell whitespace-nowrap text-text-secondary">{onDay(r.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableCard>
        </SectionState>
      </SubSection>
      {canOthers && <ApplyLeaveForPanel open={onBehalf} onClose={() => setOnBehalf(false)} employeeId={employeeId} name={name || firstName} companyId={companyId!} />}
    </div>
  )
}
