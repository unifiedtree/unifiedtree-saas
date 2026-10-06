// The Approvals page with the phone app's extra kinds: leave waiting for HR comes with the inbox (includeL2), and
// advances, overtime and skill levels are read only with their approve permission. Your own request shows without
// buttons. Rendered as markup (the repo has no DOM test environment).
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApprovalsInbox, InboxRow } from '../api/shared/contracts'
import type { InboxParams } from '../api/shared/useApprovalsInbox'

let held = new Set<string>()
vi.mock('@unifiedtree/sdk', async () => ({
  ...(await vi.importActual<object>('@unifiedtree/sdk')),
  usePermission: (code: string) => held.has(code),
  useAnyPermission: (codes: string[]) => codes.some((c) => held.has(c)),
}))

const l2: InboxRow = {
  kind: 'LEAVE_L2', requestId: 'l2', employeeId: 'e9', employeeName: 'Deepa Nair', employeeCode: null, departmentName: null,
  createdAt: '2026-10-05T03:00:00Z', title: 'Casual leave', fromDate: '2026-10-12', toDate: '2026-10-13', days: 2, amount: null,
  currency: null, reason: null, facts: [{ key: 'managerApproved', label: 'Approved by', value: 'Manager One' }], warnings: [],
  canDecide: true, rejectNeedsReason: false,
}
const inbox: ApprovalsInbox = {
  counts: { all: 1, leave: 1, attendance: 0, requests: 0, expenses: 0 }, tabs: ['all', 'leave', 'requests'], rows: [l2],
  page: 0, size: 50, totalElements: 1, recentDecisions: [], unavailable: [],
}
let asked: InboxParams | undefined
vi.mock('../api/shared/useApprovalsInbox', async () => ({
  ...(await vi.importActual<object>('../api/shared/useApprovalsInbox')),
  useApprovalsInbox: (p: InboxParams) => { asked = p; return { data: inbox, isLoading: false, error: null, notAvailable: false, refetch: () => {} } },
}))
vi.mock('../api/shared/useRecentDecisions', () => ({ useRecentDecisions: () => ({ data: [] }) }))
vi.mock('./useTeamDecisions', () => ({ useTeamDecisions: () => ({ decide: vi.fn(), approveAll: vi.fn(), undo: vi.fn() }) }))
vi.mock('@/shared/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ isSuccess: true, isLoading: false, data: { id: 'u1', email: 'x', employeeId: 'me-1' } }) }))

const fetched: string[] = []
vi.mock('@/core/api/client', async () => ({
  ...(await vi.importActual<object>('@/core/api/client')),
  apiJson: async (path: string) => { fetched.push(path); return [] },
}))

import { TeamApprovals } from './TeamApprovals'
import { useExtraApprovalsAccess } from './useExtraApprovals'

const render = (codes: string[], qc = new QueryClient()) => {
  held = new Set(codes)
  return renderToStaticMarkup(<QueryClientProvider client={qc}><TeamApprovals tab="all" onTab={() => {}} /></QueryClientProvider>)
}

let access: ReturnType<typeof useExtraApprovalsAccess>
function AccessProbe() { access = useExtraApprovalsAccess(); return null }
const accessFor = (codes: string[]) => { held = new Set(codes); renderToStaticMarkup(<AccessProbe />); return access }

beforeEach(() => { asked = undefined; fetched.length = 0 })

describe('Approvals page: leave waiting for HR', () => {
  it('asks the inbox for it and shows it with its own label', () => {
    const html = render(['hrms.leave.approve.l1', 'hrms.leave.approve.l2'])
    expect(asked).toMatchObject({ tab: 'all', includeL2: true })
    expect(html).toContain('Deepa Nair')
    expect(html).toContain('Leave · HR approval')
  })
})

describe('Approvals page: advances, overtime and skill levels', () => {
  it('reads each list only with its approve permission (overtime also needs the team list)', () => {
    expect(accessFor(['hrms.leave.approve.l1'])).toEqual({ canAdvances: false, canOvertime: false, canSkills: false })
    expect(accessFor(['hrms.advance.approve'])).toEqual({ canAdvances: true, canOvertime: false, canSkills: false })
    expect(accessFor(['attendance.overtime.approve'])).toMatchObject({ canOvertime: false })
    expect(accessFor(['attendance.overtime.approve', 'attendance.team.read'])).toMatchObject({ canOvertime: true })
    expect(accessFor(['hrms.learning.skill.approve'])).toMatchObject({ canSkills: true })
  })

  it('shows the extra rows next to the inbox, and your own without buttons', () => {
    const qc = new QueryClient()
    qc.setQueryData(['team', 'approvals', 'extra', 'advances'], [
      { id: 'a1', employeeId: 'e1', employeeName: 'Asha Rao', companyId: 'c', amount: 12000, repaymentMonths: 3, monthlyDeduction: 4000,
        status: 'REQUESTED', outstandingAmount: 12000, createdAt: '2026-10-05T05:00:00Z' },
    ])
    qc.setQueryData(['team', 'approvals', 'extra', 'skills'], [
      { id: 's1', employeeId: 'me-1', employeeName: 'Me Myself', skillName: 'SQL', currentProficiency: 1, proposedProficiency: 3,
        status: 'PENDING', createdAt: '2026-10-04T05:00:00Z' },
    ])
    const html = render(['hrms.leave.approve.l1', 'hrms.advance.approve', 'hrms.learning.skill.approve'], qc)
    expect(html).toContain('Asha Rao')
    expect(html).toContain('Salary advance')
    expect(html).toContain('SQL: Beginner → Intermediate')
    // newest first: the advance (05:00) above the HR leave (03:00) above the skill (a day earlier)
    expect(html.indexOf('Asha Rao')).toBeLessThan(html.indexOf('Deepa Nair'))
    expect(html.indexOf('Deepa Nair')).toBeLessThan(html.indexOf('Me Myself'))
    expect(html.slice(html.indexOf('Me Myself'))).toContain('not yours to decide')
    // All counts the extras too
    expect(html).toContain('3 requests are waiting from your team.')
  })

  it('without those permissions, nothing extra is read or shown', () => {
    const qc = new QueryClient()
    qc.setQueryData(['team', 'approvals', 'extra', 'advances'], [
      { id: 'a1', employeeId: 'e1', employeeName: 'Asha Rao', companyId: 'c', amount: 12000, repaymentMonths: 3, monthlyDeduction: 4000,
        status: 'REQUESTED', outstandingAmount: 12000, createdAt: '2026-10-05T05:00:00Z' },
    ])
    const html = render(['hrms.leave.approve.l1'], qc)
    expect(html).not.toContain('Asha Rao')
    expect(fetched).toEqual([])
  })
})
