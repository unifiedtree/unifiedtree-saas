// My salary (/me/salary), audit 4 Oct: the page sits in the page frame (it had
// no gutter), "From CTC to take-home" puts the minus on what is taken away and
// not on whichever row lands second, and "PF · enrolled" isn't shown beside ₹0
// deductions when the company has PF switched off. Rendered as markup (the repo
// has no DOM test environment).
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { EmployeeSalaryStructure } from '../api/usePayroll'

let structure: Partial<EmployeeSalaryStructure> | undefined
let history: unknown[] = []
vi.mock('@unifiedtree/sdk', async () => ({
  ...(await vi.importActual<object>('@unifiedtree/sdk')),
  usePermission: () => true,
}))
vi.mock('../api/usePayroll', () => ({
  useMySalaryStructure: () => ({ data: structure, isLoading: false, error: null, refetch: () => {} }),
}))
vi.mock('../api/usePayrollRuns', async () => ({
  ...(await vi.importActual<object>('../api/usePayrollRuns')),
  useMyStructureHistory: () => ({ data: history, isLoading: false, error: null, refetch: () => {} }),
}))

import { MySalaryStructure } from './MySalaryStructure'

const base: Partial<EmployeeSalaryStructure> = {
  id: 's1', employeeId: 'e1', ctcAnnual: 300000, ctcMonthly: 25000, pfApplicable: true, pfStatus: 'ENROLLED',
  taxRegime: 'NEW', effectiveFrom: '2026-04-01', isCurrent: true, lines: [],
  earnings: [{ componentCode: 'BASIC', componentName: 'Basic', category: 'EARNING', monthlyAmount: 25000 } as never],
  deductions: [], employerContributions: [], grossMonthly: 25000, totalDeductions: 0, netMonthly: 25000, employerContribMonthly: 0,
}
const render = (s: Partial<EmployeeSalaryStructure>) => {
  structure = s
  return renderToStaticMarkup(<MemoryRouter><MySalaryStructure /></MemoryRouter>)
}
/** The amount text after a Flow row's label, up to the row's closing span. */
const rowAmount = (html: string, label: string) => {
  const at = html.indexOf(`>${label}</span>`)
  expect(at, `${label} row`).toBeGreaterThan(-1)
  return html.slice(at + label.length + 9, html.indexOf('</span></span>', at))
}

describe('My salary', () => {
  it('Salary history: one row per revision, keyed by the structureId the server sends (no React key warning)', () => {
    // GET /v1/payroll/structures/me/history rows (SalaryHistoryDto): structureId, not id.
    history = [
      { structureId: 's2', effectiveFrom: '2026-04-01', effectiveTo: null, ctcAnnual: 360000, ctcMonthly: 30000, changePercent: 20, reason: 'Annual revision', current: true, taxRegime: 'NEW' },
      { structureId: 's1', effectiveFrom: '2025-04-01', effectiveTo: '2026-03-31', ctcAnnual: 300000, ctcMonthly: 25000, changePercent: null, reason: null, current: false, taxRegime: 'NEW' },
    ]
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const html = render(base)
      expect(html).toContain('Annual revision')
      expect(html).toContain('+20.0%')
      expect(err.mock.calls.map((c) => String(c[0])).filter((m) => /unique "key"|key prop/.test(m))).toEqual([])
    } finally {
      err.mockRestore()
      history = []
    }
  })

  it('sits in the self-service page frame', () => {
    const html = render(base)
    expect(html).toContain('class="uk-page uk-page--narrow"')
    expect(html).toContain('aria-label="My salary"')
  })

  it('puts no minus on Gross pay when employer contributions are 0', () => {
    const html = render(base)
    expect(rowAmount(html, 'Gross pay')).not.toContain('−')
    expect(rowAmount(html, 'Take-home')).not.toContain('−')
  })

  it('puts the minus on deductions and employer costs, never on take-home', () => {
    const html = render({ ...base, grossMonthly: 23200, employerContribMonthly: 1800, totalDeductions: 2000, netMonthly: 21200 })
    expect(rowAmount(html, 'Employer PF, gratuity and health cover')).toContain('−')
    expect(rowAmount(html, 'Tax, PF and professional tax')).toContain('−')
    expect(rowAmount(html, 'Gross pay')).not.toContain('−')
    expect(rowAmount(html, 'Take-home')).not.toContain('−')
  })

  it('says PF is not deducted when it is off in payroll settings', () => {
    expect(render({ ...base, pfOn: false })).toContain('PF · not deducted (off in payroll settings)')
    expect(render({ ...base, pfOn: true })).toContain('PF · enrolled')
    expect(render({ ...base })).toContain('PF · enrolled')
    expect(render({ ...base, pfApplicable: false, pfOn: false })).toContain('PF not applicable')
  })
})
