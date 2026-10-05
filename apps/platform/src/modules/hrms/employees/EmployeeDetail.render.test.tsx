// The employee profile (/hrms/employees/:id) as HR sees it, with the records testers opened on
// demo-hrms on 5 Oct 2026: on probation with no end or confirmation date, no shift, no department,
// branch, designation or manager, no login, joined today, a web punch today, a day the server sent
// without a status, a far-future attendance day and a document summary without its titles. The
// Overview must render (the page showed "This page hit an error"). Rendered as markup (the repo has
// no DOM test environment), with each data hook answering as the server did.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { istToday } from '@/design/dc/dates'

const today = istToday()
const ok = <T,>(data: T) => ({ data, isLoading: false, isFetching: false, error: null, isError: false, refetch: () => Promise.resolve() })
const mutation = { mutateAsync: async () => ({}), mutate: () => {}, isPending: false }
const answers: Record<string, unknown> = {}

vi.mock('@unifiedtree/sdk', async () => ({ ...(await vi.importActual<object>('@unifiedtree/sdk')), usePermission: () => true }))
vi.mock('./api/useInvitation', () => ({ sendInvite: async () => ({}), resendInvite: async () => ({}) }))
vi.mock('./api/useFaceAdmin', () => ({ resetFaceEnrollment: async () => ({}) }))
vi.mock('@/shared/hooks/useCurrentUser', () => ({ useCurrentUser: () => ok({ employeeId: 'viewer' }) }))
vi.mock('../api/useWorkforce', async () => ({
  ...(await vi.importActual<object>('../api/useWorkforce')),
  useWorkforceEmployee: () => ok(answers.employee), useEmployeesByIds: () => ok([]),
  useConfirmEmployee: () => mutation, useStartNotice: () => mutation, useExitEmployee: () => mutation, useCancelNotice: () => mutation, useUpdateWorkforceEmployee: () => mutation,
}))
vi.mock('../api/useProbation', () => ({ useExtendProbation: () => mutation }))
vi.mock('../api/useOrg', async () => ({
  ...(await vi.importActual<object>('../api/useOrg')),
  useCompanies: () => ok([{ id: 'c1', name: 'Demo' }]), useDepartments: () => ok([]), useDesignations: () => ok([]), useBranches: () => ok([]), useEmploymentTypes: () => ok([]),
}))
vi.mock('../api/useAttendance', async () => ({ ...(await vi.importActual<object>('../api/useAttendance')), useEmployeeWeeklySummary: () => ok(answers.week) }))
vi.mock('../api/useShiftPolicies', async () => ({ ...(await vi.importActual<object>('../api/useShiftPolicies')), useEmployeeShift: () => ok(answers.shift), useShiftPolicies: () => ok([]) }))
vi.mock('../api/usePayroll', async () => ({ ...(await vi.importActual<object>('../api/usePayroll')), useEmployeeStructure: () => ok(null) }))
vi.mock('../api/useDocument', async () => ({
  ...(await vi.importActual<object>('../api/useDocument')),
  useEmployeeDocuments: () => ok({ content: [], totalElements: 0 }), useEmployeeDocumentSummary: () => ok(answers.docSummary),
}))
vi.mock('../api/usePerformance', async () => ({ ...(await vi.importActual<object>('../api/usePerformance')), useEmployeeKpis: () => ok({ total: 0 }) }))
vi.mock('../api/useLeave', async () => ({ ...(await vi.importActual<object>('../api/useLeave')), useEmployeeLeaveBalances: () => ok([]) }))
vi.mock('./api/useProfileData', async () => ({
  ...(await vi.importActual<object>('./api/useProfileData')),
  useEmployeeMonth: () => ok(answers.month), useInvitationStatus: () => ok(answers.invitation),
}))
vi.mock('../attendance/face/FaceEnrollment', async () => ({ ...(await vi.importActual<object>('../attendance/face/FaceEnrollment')), useEmployeeFaceStatus: () => ok(answers.face) }))
vi.mock('./workspace/EmployeeAccess', async () => ({ ...(await vi.importActual<object>('./workspace/EmployeeAccess')), useCanManageAccess: () => true }))

import { EmployeeDetail } from './EmployeeDetail'

// demo-hrms, 5 Oct: a new joiner on probation with nothing else filled in.
const newJoiner = {
  id: 'e23e46cd-bb88-4b05-a2d0-0469982e6fc4', employeeCode: 'EMP-0042', companyId: 'c1', firstName: 'Varsha', lastName: null, email: 'varsha@example.com',
  employmentStatus: 'PROBATION', employmentType: 'FULL_TIME', dateOfJoining: today, probationEndDate: null, confirmationDate: null,
  departmentId: null, designationId: null, branchId: null, reportingManagerId: null, hasAccount: false, faceEnrolled: false,
}
function render(o: Partial<typeof answers> = {}) {
  Object.assign(answers, {
    employee: newJoiner,
    // No shift: every field empty, as EmployeeShiftService answers.
    shift: { employeeId: newJoiner.id, shiftPolicyId: null, shiftName: null, startTime: null, endTime: null, gracePeriodMinutes: 0 },
    week: { totalHours: 0.5, presentDays: 1, days: [{ date: today, status: 'PRESENT', checkInTime: '13:17', checkOutTime: null, hours: 0.5 }] },
    // A web punch today, a day the server sent without a status, and a far-future day.
    month: [
      { date: today, status: 'PRESENT', checkInTime: `${today}T07:47:00Z`, checkOutTime: null, checkInMethod: 'WEB' },
      { date: `${today.slice(0, 8)}01`, status: null },
      { date: '2099-12-31', status: 'PRESENT', checkInTime: '2099-12-31T04:00:00Z', checkInMethod: 'WEB' },
    ],
    docSummary: { onFile: 1, expired: 1, waitingForHr: 0, expiringSoon: 0, rejected: 0 },
    invitation: { activated: false, invitedAt: '', lastLoginAt: '', lastLoginDevice: '' },
    face: { hasLogin: false, status: 'NOT_ENROLLED', samplesRequired: 3, samplesCaptured: 0, remainingAngles: [], lockedRequiresManagerReset: false, enrolledAt: 'not a date' },
    ...o,
  })
  const qc = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/hrms/employees/${newJoiner.id}`]}>
        <Routes><Route path="/hrms/employees/:id" element={<EmployeeDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('employee profile with demo-hrms records (5 Oct)', () => {
  it('renders the Overview of a new joiner on probation with nothing else filled in', () => {
    const html = render()
    expect(html).toContain('Varsha')
    expect(html).toContain('Probation end date not set')
    expect(html).toContain('No shift assigned')
    expect(html).toContain('No manager set')
  })

  it('still names the expired documents when the summary carries no titles', () => {
    expect(render()).toContain('1 document expired')
  })

  it('renders someone with a login, a shift and a full summary too', () => {
    const html = render({
      employee: { ...newJoiner, lastName: 'Rao', hasAccount: true, probationEndDate: '2027-01-05' },
      shift: { employeeId: newJoiner.id, shiftPolicyId: 's1', shiftName: 'General', startTime: '09:30:00', endTime: '18:30:00', gracePeriodMinutes: 10 },
      docSummary: { onFile: 2, expired: 1, expiredTitles: ['Passport'], waitingForHr: 1, expiringSoon: 0, rejected: 0, expiringTitles: [] },
      invitation: { activated: true, invitedAt: `${today}T05:00:00Z`, lastLoginAt: `${today}T07:40:00Z`, lastLoginDevice: 'Chrome on Windows' },
      face: { hasLogin: true, status: 'ACTIVE', samplesRequired: 3, samplesCaptured: 3, remainingAngles: [], lockedRequiresManagerReset: false, enrolledAt: `${today}T07:00:00Z` },
    })
    expect(html).toContain('Varsha Rao')
    expect(html).toContain('Passport')
    expect(html).toContain('General')
  })
})
