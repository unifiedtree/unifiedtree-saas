import { test, expect, request as pwRequest } from '@playwright/test'

// Live HR-workflow regression against the prod-backed `ravi` tenant. Exercises the
// real state machines (attendance manual-entry, leave apply→approve, expense
// submit→approve→reimburse) and asserts the status transitions. Re-runnable: each
// run creates uniquely-tagged rows; it does NOT bulk-create employees.
//
// Env (no secrets committed):
//   E2E_LIVE_PASSWORD  (required) — admin (E2E_LIVE_EMAIL, default ravi@gmail.com)
//   E2E_EMP_EMAIL / E2E_EMP_PASSWORD (required) — a non-admin EMPLOYEE-role account

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://erpinfrastructure-production.up.railway.app'
const TENANT_ID = process.env.E2E_LIVE_TENANT_ID ?? '433cdd35-6d58-45bd-8db8-b468b3711fb7'
const SUB = process.env.E2E_LIVE_SUBDOMAIN ?? 'ravi'
const ADMIN_EMAIL = process.env.E2E_LIVE_EMAIL ?? 'ravi@gmail.com'
const ADMIN_PW = process.env.E2E_LIVE_PASSWORD
const EMP_EMAIL = process.env.E2E_EMP_EMAIL
const EMP_PW = process.env.E2E_EMP_PASSWORD
const tag = process.env.E2E_TAG ?? 'wf'
const today = new Date().toISOString().slice(0, 10)

let api: import('@playwright/test').APIRequestContext
let adminTok = ''
let empTok = ''
let empEmpId = ''

async function login(email: string, password: string) {
  const r = await api.post(`${BACKEND}/api/v1/canonical-auth/login`, { data: { tenantId: TENANT_ID, email, password } })
  expect(r.ok(), `login ${email}`).toBeTruthy()
  return (await r.json()).accessToken as string
}
const hdr = (t: string) => ({ Authorization: `Bearer ${t}`, 'X-Tenant-Subdomain': SUB })

test.beforeAll(async () => {
  test.skip(!ADMIN_PW || !EMP_PW, 'Set E2E_LIVE_PASSWORD + E2E_EMP_EMAIL/E2E_EMP_PASSWORD to run live workflow tests')
  api = await pwRequest.newContext()
  adminTok = await login(ADMIN_EMAIL, ADMIN_PW!)
  empTok = await login(EMP_EMAIL!, EMP_PW!)
  empEmpId = JSON.parse(Buffer.from(empTok.split('.')[1], 'base64url').toString()).employee_id
    ?? JSON.parse(Buffer.from(empTok.split('.')[1], 'base64url').toString()).sub
})
test.afterAll(async () => { await api?.dispose() })

test('attendance: manual-entry succeeds (regression for the CHECK-constraint 500)', async () => {
  const r = await api.post(`${BACKEND}/api/v1/attendance/manual-entry`, {
    headers: hdr(adminTok),
    data: { employeeId: empEmpId, attendanceDate: today, attendanceStatus: 'PRESENT', checkInAt: `${today}T09:00:00Z`, attendanceType: 'OFFICE', reason: `${tag} regression` },
  })
  expect(r.status(), 'manual-entry must not 500').toBe(200)
})

test('leave: apply → approve transitions to APPROVED', async () => {
  const companyId = (await (await api.get(`${BACKEND}/api/v1/hrms/companies`, { headers: hdr(adminTok) })).json())[0]?.id
  const lt = await api.post(`${BACKEND}/api/v1/leave/types?companyId=${companyId}`, {
    headers: hdr(adminTok), data: { name: `Casual ${tag} ${Date.now()}`, code: `C${String(Date.now()).slice(-6)}`, category: 'CASUAL', annualEntitlement: 12, isPaidLeave: true },
  })
  expect(lt.status(), 'create leave type').toBeLessThan(300)
  const leaveTypeId = (await lt.json()).id

  await api.get(`${BACKEND}/api/v1/leave/my/balances`, { headers: hdr(empTok) })
  const apply = await api.post(`${BACKEND}/api/v1/leave/apply?companyId=${companyId}`, {
    headers: hdr(empTok), data: { leaveTypeId, startDate: '2026-09-14', endDate: '2026-09-14', duration: 'FULL_DAY', reason: `${tag} test` },
  })
  expect(apply.status(), 'apply leave').toBe(201)
  const reqId = (await apply.json()).id

  const dec = await api.post(`${BACKEND}/api/v1/leave/${reqId}/decision`, { headers: hdr(adminTok), data: { status: 'APPROVED', comment: `${tag} ok` } })
  expect(dec.status()).toBeLessThan(300)
  expect((await dec.json()).status).toBe('APPROVED')
})

test('expense: submit → approve → reimburse transitions to REIMBURSED', async () => {
  const claim = await api.post(`${BACKEND}/api/v1/expense/claims`, {
    headers: hdr(empTok), data: { title: `${tag} travel ${Date.now()}`, currency: 'INR', items: [{ category: 'TRAVEL', amount: 1200, expenseDate: today }] },
  })
  expect(claim.status(), 'submit claim').toBe(201)
  const claimId = (await claim.json()).id
  expect((await claim.json()).status ?? 'SUBMITTED').toBe('SUBMITTED')

  const dec = await api.post(`${BACKEND}/api/v1/expense/claims/${claimId}/decision`, { headers: hdr(adminTok), data: { approved: true, comment: `${tag}` } })
  expect(dec.status()).toBeLessThan(300)
  expect((await dec.json()).status).toBe('APPROVED')

  const reim = await api.post(`${BACKEND}/api/v1/expense/claims/${claimId}/reimburse`, { headers: hdr(adminTok) })
  expect(reim.status()).toBeLessThan(300)
  expect((await reim.json()).status).toBe('REIMBURSED')
})
