// "Payment needed" (402 MODULE_PAUSED): reading the server's answer, which pages stay open, and the
// screen the shell shows in place of the page. Rendered as markup (the repo has no DOM test environment).
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { asModulePaused, clearModulePaused, dueText, getModulePaused, moduleName, openWhilePaused, reportModulePaused } from './modulePaused'
import { ModulePausedGate, ModulePausedScreen } from './ModulePausedScreen'

const BODY = {
  code: 'MODULE_PAUSED', error: 'subscription_lapsed', moduleKey: 'hrms', companyId: 'c1', dueAmountInr: 12000,
  dueSince: '2026-11-06', graceEndedOn: '2026-11-13', canPay: true,
  message: 'HRMS is paused because the payment due on 6 Nov was not received. Pay to continue.',
}

afterEach(() => clearModulePaused())

describe('asModulePaused', () => {
  it('reads a 402 MODULE_PAUSED body', () => {
    expect(asModulePaused(402, BODY)).toEqual({
      code: 'MODULE_PAUSED', moduleKey: 'hrms', companyId: 'c1', dueAmountInr: 12000, dueSince: '2026-11-06', graceEndedOn: '2026-11-13',
      canPay: true, message: BODY.message,
    })
  })
  it('reads the older lapsed answer (no code) as a paused HRMS, without canPay', () => {
    expect(asModulePaused(402, { error: 'subscription_lapsed', status: 'HALTED', graceExpiredAt: null, message: ' Renew your mandate. ' })).toEqual({
      code: 'MODULE_PAUSED', moduleKey: 'hrms', companyId: null, dueAmountInr: null, dueSince: null, graceEndedOn: null,
      canPay: false, message: 'Renew your mandate.', legacy: true,
    })
    expect(asModulePaused(403, { error: 'subscription_lapsed' })).toBeNull()
  })
  it('ignores the seat limit, other errors and other statuses', () => {
    expect(asModulePaused(402, { code: 'SEAT_LIMIT_EXCEEDED' })).toBeNull()
    expect(asModulePaused(402, { error: 'something_else' })).toBeNull()
    expect(asModulePaused(403, BODY)).toBeNull()
    expect(asModulePaused(402, null)).toBeNull()
  })
  it('canPay only when the server says true; a missing amount stays empty', () => {
    expect(asModulePaused(402, { code: 'MODULE_PAUSED', canPay: 'yes', dueAmountInr: null })).toEqual(expect.objectContaining({ canPay: false, dueAmountInr: null, moduleKey: 'hrms' }))
    expect(dueText(null)).toBeNull()
    expect(dueText(12000)).toBe('₹12,000')
  })
  it('attendance, leave and payroll are parts of HRMS', () => {
    for (const k of ['hrms', 'attendance', 'leave', 'payroll']) expect(moduleName(k)).toBe('HRMS')
  })
})

describe('pages open while paused', () => {
  it('sign-in, plan, billing and notifications stay open; module pages do not', () => {
    for (const p of ['/login', '/plan', '/settings/billing', '/notifications']) expect(openWhilePaused(p)).toBe(true)
    for (const p of ['/hrms/employees', '/dashboard', '/me/salary', '/settings', '/planner']) expect(openWhilePaused(p)).toBe(false)
  })
})

describe('the screen', () => {
  const screen = (canPay: boolean, moduleKey = 'hrms') => renderToStaticMarkup(
    <ModulePausedScreen paused={asModulePaused(402, { ...BODY, canPay, moduleKey })!} onPay={() => {}} onRetry={() => {}} />)

  it('a payer gets Pay now, the amount and the dates', () => {
    const html = screen(true)
    expect(html).toContain('Payment needed')
    expect(html).toContain('HRMS is paused')
    expect(html).toContain(BODY.message)
    expect(html).toContain('Amount due: ₹12,000 · Due since 6 Nov 2026 · Grace period ended 13 Nov 2026')
    expect(html).toContain('Pay now')
    expect(html).not.toContain('Ask your business owner')
  })
  it('anyone else is asked to tell their owner, with no Pay button', () => {
    const html = screen(false)
    expect(html).toContain('Ask your business owner to pay.')
    expect(html).not.toContain('Pay now')
    expect(html).toContain('Try again')
  })
  it('a refused attendance call still says "HRMS is paused"', () => {
    expect(screen(true, 'attendance')).toContain('HRMS is paused')
  })

  const gate = (path: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><ModulePausedGate><p>the page</p></ModulePausedGate></MemoryRouter>)
  it('the gate shows the page until a call is refused, then the screen, except on the pages that stay open', () => {
    expect(gate('/dashboard')).toContain('the page')
    reportModulePaused(asModulePaused(402, BODY)!)
    expect(getModulePaused()).not.toBeNull()
    const paused = gate('/dashboard')
    expect(paused).toContain('Payment needed')
    expect(paused).not.toContain('the page')
    expect(gate('/plan')).toContain('the page')
    expect(gate('/settings/billing')).toContain('the page')
  })
  it('the older lapsed answer shows the screen too; without the billing permission there is no Pay button', () => {
    reportModulePaused(asModulePaused(402, { error: 'subscription_lapsed', status: 'HALTED', message: 'Renew your mandate.' })!)
    const html = gate('/hrms/employees')
    expect(html).toContain('HRMS is paused')
    expect(html).toContain('Renew your mandate.')
    expect(html).toContain('Ask your business owner to pay.')
    expect(html).not.toContain('Pay now')
    expect(gate('/login')).toContain('the page')
  })
})
