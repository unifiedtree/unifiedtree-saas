// Ask payroll's queue (V143.86): HR answers payslip questions with
// payroll.queries.answer, the payroll team with payroll.runs.manage; anyone else
// sees Answer greyed out. The same codes open the queue on the payroll dashboard
// (pageRegistry). Rendered as markup (the repo has no DOM test environment).
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PayslipQuery } from '../../api/usePayrollRuns'
import { ALL_PAGE_ENTRIES } from '@/shared/navigation/pageRegistry'
import { accessState, type AccessContext } from '@/shared/navigation/access'

let held = new Set<string>()
vi.mock('@unifiedtree/sdk', async () => ({
  ...(await vi.importActual<object>('@unifiedtree/sdk')),
  usePermission: (code: string) => held.has(code),
  useAnyPermission: (codes: string[]) => codes.some((c) => held.has(c)),
}))
const question: PayslipQuery = {
  id: 'q1', runId: 'r1', employeeId: 'e1', employeeName: 'Reader User', employeeCode: 'EMP002', period: 'Sep 2026',
  message: 'Why is my September net lower?', status: 'OPEN', answer: null, answeredByName: null, answeredAt: null,
  createdAt: '2026-09-27T09:00:00Z',
}
vi.mock('../../api/usePayrollRuns', async () => ({
  ...(await vi.importActual<object>('../../api/usePayrollRuns')),
  usePayQueries: () => ({ data: [question], isLoading: false, error: null, refetch: () => {} }),
  useAnswerPayQuery: () => ({ mutateAsync: async () => ({}), isPending: false }),
  useDeletePayQuery: () => ({ mutateAsync: async () => undefined, isPending: false }),
}))

import { AskPayrollQueue, PAY_QUERY_CODES } from './AskPayrollAdminQueue'

const render = (codes: string[]) => {
  held = new Set(codes)
  return renderToStaticMarkup(<AskPayrollQueue />)
}
/** The Answer button's opening tag. */
const answerButton = (html: string) => {
  const end = html.indexOf('>Answer<')
  expect(end, 'Answer button').toBeGreaterThan(-1)
  return html.slice(html.lastIndexOf('<button', end), end)
}

describe('Ask payroll queue: who may answer', () => {
  it('reads and answers with the same two codes the API accepts', () => {
    expect(PAY_QUERY_CODES).toEqual(['payroll.runs.manage', 'payroll.queries.answer'])
  })

  it('HR with payroll.queries.answer (and no payroll.runs.manage) can answer', () => {
    const b = answerButton(render(['payroll.runs.read', 'payroll.queries.answer']))
    expect(b).toContain('aria-label="Answer this question"')
    expect(b).not.toContain('disabled')
  })

  it('the payroll team with payroll.runs.manage still can', () => {
    const b = answerButton(render(['payroll.runs.read', 'payroll.runs.manage']))
    expect(b).toContain('aria-label="Answer this question"')
    expect(b).not.toContain('disabled')
  })

  it('someone with neither sees Answer greyed out', () => {
    const b = answerButton(render(['payroll.runs.read']))
    expect(b).toContain('disabled')
    expect(b).toContain('aria-label="Only the payroll team or HR can answer"')
  })
})

describe('the payroll dashboard (where the queue sits) opens for the same codes', () => {
  const ctx = (perms: string[]): AccessContext => {
    const set = new Set(perms)
    return { has: (c) => set.has(c), modules: ['hrms', 'payroll'], self: true, adminRole: false, planAdmin: false }
  }
  const page = (id: string) => ALL_PAGE_ENTRIES.find((e) => e.id === id)!
  const opens = (id: string, perms: string[]) => accessState(page(id).access, ctx(perms)) === 'open'

  it('payroll.queries.answer alone opens the dashboard, but not payroll runs, salaries or bank files', () => {
    expect(opens('pay-dashboard', ['payroll.queries.answer'])).toBe(true)
    expect(opens('pay-runs', ['payroll.queries.answer'])).toBe(false)
    expect(opens('pay-salary', ['payroll.queries.answer'])).toBe(false)
    expect(opens('pay-bank', ['payroll.queries.answer'])).toBe(false)
  })

  it('an employee with only their own payslip does not get it', () => {
    expect(opens('pay-dashboard', ['payroll.payslip.read.self'])).toBe(false)
  })
})
