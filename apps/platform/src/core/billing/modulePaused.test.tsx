// "Payment needed" (402 MODULE_PAUSED): reading the server's answer, which pages stay open, and the
// screen the shell shows in place of the page. Rendered as markup (the repo has no DOM test environment).
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { asModulePaused, clearModulePaused, dueText, getModulePaused, openWhilePaused, reportModulePaused } from './modulePaused'
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
  it('ignores the old lapsed answer, the seat limit and other statuses', () => {
    expect(asModulePaused(402, { error: 'subscription_lapsed', status: 'HALTED' })).toBeNull()
    expect(asModulePaused(402, { code: 'SEAT_LIMIT_EXCEEDED' })).toBeNull()
    expect(asModulePaused(403, BODY)).toBeNull()
    expect(asModulePaused(402, null)).toBeNull()
  })
  it('canPay only when the server says true; a missing amount stays empty', () => {
    expect(asModulePaused(402, { code: 'MODULE_PAUSED', canPay: 'yes', dueAmountInr: null })).toEqual(expect.objectContaining({ canPay: false, dueAmountInr: null, moduleKey: 'hrms' }))
    expect(dueText(null)).toBeNull()
    expect(dueText(12000)).toBe('₹12,000')
  })
})

describe('pages open while paused', () => {
  it('sign-in, plan, billing and notifications stay open; module pages do not', () => {
    for (const p of ['/login', '/plan', '/settings/billing', '/notifications']) expect(openWhilePaused(p)).toBe(true)
    for (const p of ['/hrms/employees', '/dashboard', '/me/salary', '/settings', '/planner']) expect(openWhilePaused(p)).toBe(false)
  })
})

describe('the screen', () => {
  const screen = (canPay: boolean) => renderToStaticMarkup(
    <ModulePausedScreen paused={asModulePaused(402, { ...BODY, canPay })!} onPay={() => {}} onRetry={() => {}} />)

  it('a payer gets Pay now, the amount and the dates', () => {
    const html = screen(true)
    expect(html).toContain('Payment needed')
    expect(html).toContain(BODY.message)
    expect(html).toContain('Amount due: ₹12,000 · Due since 6 Nov 2026 · Grace period ended 13 Nov 2026')
    expect(html).toContain('Pay now')
    expect(html).not.toContain('Ask your workspace owner')
  })
  it('anyone else is asked to tell their owner, with no Pay button', () => {
    const html = screen(false)
    expect(html).toContain('Ask your workspace owner to pay.')
    expect(html).not.toContain('Pay now')
    expect(html).toContain('Try again')
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
})
