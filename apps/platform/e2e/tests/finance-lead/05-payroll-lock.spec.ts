import { test, expect } from '../../fixtures/test-base'
import { DEMO_COMPANY } from '../../utils/sa'

test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'finance-lead', 'finance-lead tests')
})

const KISHORE = '4aa46b4e-3c16-4011-9a48-3dbcbc7c7b55'

async function freePeriod(
  apiRequest: (p: string, init?: RequestInit) => Promise<Response>,
  month: number,
): Promise<{ month: number; year: number }> {
  const res = await apiRequest('/api/v1/payroll/runs')
  let runs: Array<{ periodMonth: number; periodYear: number; companyName?: string }> = []
  if (res.ok) {
    const b = await res.json()
    runs = Array.isArray(b) ? b : (b.content ?? b.data ?? [])
  }
  const used = new Set(runs.filter((r) => !r.companyName || r.companyName === DEMO_COMPANY).map((r) => `${r.periodMonth}-${r.periodYear}`))
  for (let y = 2097; y >= 2030; y--) if (!used.has(`${month}-${y}`)) return { month, year: y }
  return { month, year: 2097 }
}

test('finance can create → process → lock a run, and LOCKED is final', async ({ apiRequest }) => {
  const { month, year } = await freePeriod(apiRequest, 11) // November, a free year

  const create = await apiRequest('/api/v1/payroll/runs', {
    method: 'POST',
    body: JSON.stringify({ companyId: KISHORE, periodMonth: month, periodYear: year }),
  })
  expect(create.status, 'create run').toBe(201)
  const run = await create.json()
  expect(run.status).toBe('DRAFT')

  const process = await apiRequest(`/api/v1/payroll/runs/${run.id}/process`, { method: 'POST', body: '{}' })
  expect(process.status, 'process DRAFT → PROCESSING (payroll.runs.manage)').toBe(200)
  expect((await process.json()).status).toBe('PROCESSING')

  const lock = await apiRequest(`/api/v1/payroll/runs/${run.id}/lock`, { method: 'POST', body: '{}' })
  expect(lock.status, 'lock PROCESSING → LOCKED (payroll.runs.lock)').toBe(200)
  expect((await lock.json()).status).toBe('LOCKED')

  // Irreversibility: a LOCKED run is no longer PROCESSING, so re-locking is rejected by the
  // state machine (422 RUN_NOT_PROCESSED).
  const relock = await apiRequest(`/api/v1/payroll/runs/${run.id}/lock`, { method: 'POST', body: '{}' })
  expect(relock.status, 'cannot re-lock a LOCKED run').toBe(422)
})

test('payslip download from a LOCKED run (if the run has employees)', async ({ apiRequest }) => {
  const listRes = await apiRequest('/api/v1/payroll/runs')
  const body = await listRes.json()
  const runs = Array.isArray(body) ? body : (body.content ?? body.data ?? [])
  const locked = runs.find((r: { status: string; id: string }) => r.status === 'LOCKED')
  if (!locked) {
    test.info().annotations.push({ type: 'note', description: 'No LOCKED run found — payslip download not exercised.' })
    return
  }
  const emps = await apiRequest(`/api/v1/payroll/runs/${locked.id}/employees`)
  expect(emps.status, 'finance can read run employees').toBe(200)
  const empList = await emps.json()
  const rows = Array.isArray(empList) ? empList : (empList.content ?? empList.data ?? [])
  if (!rows.length) {
    test.info().annotations.push({
      type: 'note',
      description: 'LOCKED run has 0 employees (demo employees have no salary structures) — payslip PDF not exercised.',
    })
    return
  }
  const empId = rows[0].employeeId ?? rows[0].id
  const pdf = await apiRequest(`/api/v1/payroll/runs/${locked.id}/employees/${empId}/payslip.pdf`)
  expect(pdf.status, 'payslip PDF from locked run').toBe(200)
})
