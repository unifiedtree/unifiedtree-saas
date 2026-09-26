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
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { Facts, range } from '@/design/module/ModuleKit'
import { istToday } from '@/design/dc/dates'
import { useEmployeeLeaveBalances, useEmployeeLeaveRequests, type LeaveApprovalStatus } from '../../api/useLeave'
import { SectionState, SubSection } from './shared'

const STATUS: Record<LeaveApprovalStatus, [string, PillTone]> = {
  PENDING: ['Waiting for manager', 'warn'], PENDING_L2: ['Waiting for HR', 'warn'],
  APPROVED: ['Approved', 'ok'], REJECTED: ['Rejected', 'red'], CANCELLED: ['Cancelled', 'gray'],
}
const PAGE_SIZE = 10
const n = (d: number) => (Number.isInteger(d) ? String(d) : d.toFixed(1))
const days = (d: number) => `${n(d)} ${d === 1 ? 'day' : 'days'}`
/** An instant as the viewer's calendar day (India for our users), never the UTC date. */
const onDay = (at?: string) => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export function EmployeeLeave({ employeeId, firstName }: { employeeId: string; firstName: string }) {
  const navigate = useNavigate()
  const canDecide = usePermission('hrms.leave.approve.l1')
  const year = Number(istToday().slice(0, 4))
  const [page, setPage] = useState(0)
  const balances = useEmployeeLeaveBalances(employeeId, year)
  const requests = useEmployeeLeaveRequests(employeeId, page, PAGE_SIZE)
  useClampedPage(page, requests.data?.totalPages, setPage)
  const rows = requests.data?.content ?? []
  const bal = balances.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <SubSection title={`Leave balance · ${year}`} hint={`What ${firstName} has left this year, per leave type.`}>
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
              {days(b.available)} left
              <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#64748b', marginTop: 2 }}>
                {`${n(b.used)} used · ${n(b.pending)} pending · ${n(b.totalEntitlement + (b.carryForward || 0))} total`}
              </span>
            </>,
          }))} />
        </SectionState>
      </SubSection>

      <SubSection title="Leave requests" hint="Newest first, with where each one stands."
        action={canDecide ? <HrButton size="sm" variant="ghost" onClick={() => navigate('/hrms/leave')}>Open Leave centre</HrButton> : undefined}>
        <SectionState
          isLoading={requests.isLoading} error={requests.error} onRetry={() => requests.refetch()}
          isEmpty={!requests.isLoading && !requests.error && rows.length === 0}
          emptyIcon={Plane} emptyTitle="No leave requests yet"
          emptyHint={`Requests ${firstName} makes appear here with their status.`}
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
                        {r.status === 'REJECTED' && r.approverComment && <span className="mt-1 block text-xs text-[#b91c1c]">{r.approverComment}</span>}
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
    </div>
  )
}
