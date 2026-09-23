/** Controlled-fixture checks for company-admin dashboard, dated attendance drilldown,
 * module navigation and mobile layout. These do not verify the live backend. */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const OUT = process.env.RECOVERY_OUTPUT || 'test-results/recovery'
mkdirSync(OUT, { recursive: true })
const BASE = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'

const ADMIN = `attendance.checkin.self attendance.regularization.approve hrms.employee.read hrms.employee.write attendance.team.read hrms.leave.approve.l1
  leave.balance.read payroll.runs.read payroll.structure.read payroll.structure.manage
  org.company.read workspace.context.read hrms.document.read hrms.letters.read
  hrms.compliance.read hrms.learning.read hrms.pli.read hrms.fnf.read hrms.shift.write
  hrms.advance.read hrms.performance.read settings.read audit.read
  hrms.report.headcount hrms.hiring.read`.split(/\s+/).filter(Boolean)

/** No attendance.team.read, no employee.read → the gated tiles must vanish. */
const BARE = `leave.request.self leave.balance.read workspace.context.read hrms.ess.read`
  .split(/\s+/).filter(Boolean)

let authRoles = ['COMPANY_ADMIN']
let authPerms = [...ADMIN]

/* ── Roster fixture ────────────────────────────────────────────────────────
   Deliberately exercises every bucket boundary the server defines:
     present = checked in, not late, not half-day, not WFH
     late / halfDay by status; wfh by attendanceType
     onLeave from approved leave (including someone who ALSO punched)
     notMarked = no punch at all;  absent = notMarked AND not on leave      */
const STAFF = [
  { employeeId: 'p1', employeeCode: 'E01', fullName: 'Ana Present',  status: 'ON_TIME', checkInAt: '2026-09-22T03:30:00Z', attendanceType: 'OFFICE', onLeave: false, earlyCheckout: false },
  { employeeId: 'p2', employeeCode: 'E02', fullName: 'Bo Present',   status: 'ON_TIME', checkInAt: '2026-09-22T03:31:00Z', attendanceType: 'OFFICE', onLeave: false, earlyCheckout: true  },
  { employeeId: 'p3', employeeCode: 'E03', fullName: 'Cy Present',   status: 'PRESENT', checkInAt: '2026-09-22T03:32:00Z', attendanceType: 'OFFICE', onLeave: false, earlyCheckout: false },
  { employeeId: 'l1', employeeCode: 'E04', fullName: 'Di Late',      status: 'LATE',    checkInAt: '2026-09-22T05:00:00Z', attendanceType: 'OFFICE', onLeave: false, earlyCheckout: false },
  { employeeId: 'h1', employeeCode: 'E05', fullName: 'Ed Halfday',   status: 'HALF_DAY',checkInAt: '2026-09-22T03:40:00Z', attendanceType: 'OFFICE', onLeave: false, earlyCheckout: false },
  { employeeId: 'w1', employeeCode: 'E06', fullName: 'Fi Remote',    status: 'ON_TIME', checkInAt: '2026-09-22T03:45:00Z', attendanceType: 'WFH',    onLeave: false, earlyCheckout: false },
  { employeeId: 'w2', employeeCode: 'E07', fullName: 'Gus Remote',   status: 'LATE',    checkInAt: '2026-09-22T05:10:00Z', attendanceType: 'WFH',    onLeave: false, earlyCheckout: false },
  // On approved leave AND punched in — server counts them in onLeave, and the
  // punch keeps them out of notMarked/absent.
  { employeeId: 'v1', employeeCode: 'E08', fullName: 'Hal Leave',    status: 'ON_TIME', checkInAt: '2026-09-22T03:50:00Z', attendanceType: 'OFFICE', onLeave: true,  earlyCheckout: false },
  // On leave, no punch → onLeave + notMarked, but NOT absent.
  { employeeId: 'v2', employeeCode: 'E09', fullName: 'Ivy Leave',    status: 'NOT_MARKED', checkInAt: undefined, attendanceType: undefined, onLeave: true, earlyCheckout: false },
  // No punch, no leave → notMarked + absent.
  { employeeId: 'a1', employeeCode: 'E10', fullName: 'Jo Absent',    status: 'NOT_MARKED', checkInAt: undefined, attendanceType: undefined, onLeave: false, earlyCheckout: false },
  { employeeId: 'a2', employeeCode: 'E11', fullName: 'Kit Absent',   status: 'NOT_MARKED', checkInAt: undefined, attendanceType: undefined, onLeave: false, earlyCheckout: false },
].map((s) => ({ ...s, jobTitle: 'Engineer', departmentId: 'd-1', departmentName: 'Engineering', profilePhotoUrl: null, checkOutAt: null, locationName: 'HQ', latitude: null, longitude: null }))

/** Recompute the tiles exactly as AttendanceController.countSummary does. */
const checkedIn = STAFF.filter((s) => !!s.checkInAt)
const late = checkedIn.filter((s) => s.status === 'LATE').length
const halfDay = checkedIn.filter((s) => s.status === 'HALF_DAY').length
const wfh = checkedIn.filter((s) => s.attendanceType === 'WFH').length
const present = checkedIn.filter(s => !['LATE', 'HALF_DAY'].includes(s.status) && s.attendanceType !== 'WFH').length
const onLeave = STAFF.filter((s) => s.onLeave).length
const notMarked = STAFF.length - checkedIn.length
const absent = STAFF.filter((s) => !s.checkInAt && !s.onLeave).length
const earlyOut = STAFF.filter((s) => s.earlyCheckout).length
const COUNTS = { present, onLeave, late, halfDay, earlyCheckout: earlyOut, workFromHome: wfh, notMarked, absent }

/** Expected member sets per bucket — what the roster MUST list. */
const EXPECT = {
  PRESENT: checkedIn.filter((s) => s.status !== 'LATE' && s.status !== 'HALF_DAY' && s.attendanceType !== 'WFH'),
  LATE: checkedIn.filter((s) => s.status === 'LATE'),
  HALF_DAY: checkedIn.filter((s) => s.status === 'HALF_DAY'),
  WORK_FROM_HOME: checkedIn.filter((s) => s.attendanceType === 'WFH'),
  ON_LEAVE: STAFF.filter((s) => s.onLeave),
  NOT_MARKED: STAFF.filter((s) => !s.checkInAt),
  ABSENT: STAFF.filter((s) => !s.checkInAt && !s.onLeave),
  EARLY_OUT: STAFF.filter((s) => s.earlyCheckout),
}

const STRUCTURE = {
  id: 's-1', employeeId: 'emp-1', ctcAnnual: 1200000, ctcMonthly: 100000, pfApplicable: true,
  pfStatus: 'ACTIVE', taxRegime: 'NEW', effectiveFrom: '2026-04-01', isCurrent: true, lines: [],
  earnings: [
    { componentId: 'c1', componentName: 'Basic Salary', category: 'EARNING_FIXED', monthlyAmount: 50000 },
    { componentId: 'c2', componentName: 'House Rent Allowance', category: 'EARNING_FIXED', monthlyAmount: 20000 },
  ],
  deductions: [
    { componentId: 'c3', componentName: 'Provident Fund', category: 'DEDUCTION_STATUTORY', monthlyAmount: 1800 },
    { componentId: 'c4', componentName: 'Professional Tax', category: 'DEDUCTION_STATUTORY', monthlyAmount: 200 },
  ],
  employerContributions: [
    { componentId: 'c5', componentName: 'Employer PF', category: 'EMPLOYER_CONTRIBUTION', monthlyAmount: 1800 },
  ],
  grossMonthly: 70000, totalDeductions: 2000, netMonthly: 68000, employerContribMonthly: 1800,
}
const DIRECTORY = {
  content: [{ id: 'emp-1', companyId: 'c-1', employeeCode: 'E01', firstName: 'Ana', lastName: 'Present', email: 'ana@x.test', employmentStatus: 'ACTIVE', designationName: 'Engineer', active: true }],
  totalElements: STAFF.length, totalPages: 1, page: 0, pageSize: 50,
}

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1536, height: 1000 } })
const p = await ctx.newPage()
const errors = []
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 180)) })
p.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 180)))

await p.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url())
  const path = url.pathname
  const j = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

  if (path.includes('/canonical-auth/me')) return j({ userId: 'u-1', tenantId: 'a', email: 's@x.com', firstName: 'Sai', lastName: 'User', roles: authRoles, permissions: authPerms, activeModules: ['hrms', 'attendance', 'payroll'], scopes: { branches: [], departments: [], directReports: [] } })
  if (path.includes('/canonical-auth/refresh')) return j({ accessToken: 'stub' })
  if (path.includes('/workspace/status') || path.includes('/tenants/current')) return j({ tenantId: 'a', tenantName: 'Ionora', subdomain: 'demo', status: 'ACTIVE', activeModules: ['hrms', 'attendance', 'payroll'], requestedModules: [], logoUrl: null })
  if (path === '/api/v1/shifts' || path === '/api/v1/shifts/change-requests/pending') return j([])
  if (path.includes('/reports/attendance-summary')) return j([])
  if (path.includes('/attendance/dashboard/trend')) return j([])
  if (path.includes('/attendance/dashboard/sources')) return j({ date: '2026-09-22', sources: [], unknown: 0 })
  if (path.includes('/attendance/dashboard')) return j({ date: '2026-09-22', counts: COUNTS, staffStatuses: STAFF })
  if (path.endsWith('/hrms/employees/counts')) return j({ total: STAFF.length, active: STAFF.length, probation: 0, noticePeriod: 0, exited: 0, terminated: 0 })
  if (path.endsWith('/hrms/employees')) return j(DIRECTORY)
  if (path.endsWith('/hrms/companies')) return j([{ id: 'c-1', name: 'Ionora' }])
  if (path.endsWith('/hrms/departments')) return j([{ id: 'd-1', name: 'Engineering' }])
  if (path.endsWith('/hrms/designations')) return j([{ id: 'g-1', title: 'Engineer' }])
  if (path.endsWith('/hrms/branches')) return j([{ id: 'b-1', name: 'HQ' }])
  if (/\/payroll\/structures\/employee\/[^/]+\/history/.test(path)) return j([STRUCTURE])
  if (/\/payroll\/structures\/employee\//.test(path)) return j(STRUCTURE)
  if (path.includes('/payroll/components')) return j([])
  if (path.includes('/leave/overview')) return j({ pendingApprovals: 3, balances: [], recentRequests: [] })
  if (path.includes('/leave/approvals/pending')) return j({ content: [], totalElements: 3, totalPages: 1 })
  if (path.includes('/workspace/seats/usage')) return j({ purchased: 20, current: 11, remaining: 9 })
  if (path.endsWith('/v1/search')) return j({ employees: [], limit: 8, truncated: false })
  if (/\/(trend|history|my|milestones|upcoming|reminders|headcount|events)\b/.test(path)) return j([])
  return j({ content: [], totalElements: 0, totalPages: 0, page: 0, size: 10, data: [] })
})
await p.addInitScript(() => sessionStorage.setItem('__ut_access_token__', 'stub'))


// These are transport-fixture UI checks, not real-backend verification.
await p.goto(BASE + '/dashboard');
await p.waitForTimeout(6000);
await p.getByRole('heading', { name: 'Live overview', exact: true }).waitFor();
await p.screenshot({ path: OUT + '/company-admin-desktop.png', fullPage: true });
assert(await p.getByRole('navigation', { name: 'Main navigation' }).isVisible());
assert(await p.getByRole('button', { name: /Attendance corrections/ }).isVisible());
await p.getByRole('button', { name: /Late arrivals/ }).click();
await p.waitForURL(/status=LATE/);
await p.getByText('Di Late', { exact: true }).first().waitFor();
assert(new URL(p.url()).searchParams.has('date'));
await p.screenshot({ path: OUT + '/attendance-late.png', fullPage: true });
await p.goto(BASE + '/hrms/shifts');
await p.getByRole('heading', { name: 'Shifts & Overtime', exact: true }).waitFor();
await p.getByRole('navigation', { name: 'Module navigation' }).waitFor();
assert(await p.getByRole('link', { name: 'Daily Tracking', exact: true }).isVisible());
await p.setViewportSize({ width: 390, height: 844 });
await p.goto(BASE + '/dashboard');
await p.getByRole('heading', { name: 'Live overview', exact: true }).waitFor();
assert(await p.getByRole('button', { name: 'Open menu', exact: true }).isVisible());
assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await p.screenshot({ path: OUT + '/company-admin-mobile.png', fullPage: true });
assert.equal(errors.length, 0, JSON.stringify(errors));
console.log('PASS: dashboard, dated late drilldown, module tabs, mobile layout; transport fixtures only');
await b.close();
