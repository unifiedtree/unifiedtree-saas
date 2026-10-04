import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { P } from '@unifiedtree/sdk'
import {
  anotherDialogOpen, markOpened, mayPunchFromWeb, notNowToday, openedThisVisit, promptDecision, saveNotNow, type PromptFacts,
} from './punchPromptRules'

const TODAY = '2026-10-05'
const TOMORROW = '2026-10-06'

/** Everything in place: the prompt opens. */
const ok: PromptFacts = {
  ready: true,
  employee: { companyId: 'co-1' },
  allowed: true,
  day: { checkedIn: false, status: 'NOT_MARKED', webPunchAllowed: true },
  otherDialog: false,
}
const decide = (change: Partial<PromptFacts>) => promptDecision({ ...ok, ...change })
const day = (change: Partial<NonNullable<PromptFacts['day']>>) => ({ ...(ok.day as NonNullable<PromptFacts['day']>), ...change })

describe('who may be prompted at all', () => {
  const all = [P.ATTENDANCE_CHECKIN_SELF, P.ATTENDANCE_FACE_VERIFY_SELF]
  const ctx = (over: { self?: boolean; modules?: string[]; codes?: string[] } = {}) => {
    const codes = new Set(over.codes ?? all)
    return { self: over.self ?? true, modules: over.modules ?? ['hrms'], has: (c: string) => codes.has(c) }
  }

  it('an employee with HRMS, the punch and its face check', () => {
    expect(mayPunchFromWeb(ctx())).toBe(true)
  })

  it('never someone without an employee record, without HRMS, or without either permission', () => {
    expect(mayPunchFromWeb(ctx({ self: false }))).toBe(false)
    expect(mayPunchFromWeb(ctx({ modules: ['payroll'] }))).toBe(false)
    expect(mayPunchFromWeb(ctx({ codes: [P.ATTENDANCE_FACE_VERIFY_SELF] }))).toBe(false)
    expect(mayPunchFromWeb(ctx({ codes: [P.ATTENDANCE_CHECKIN_SELF] }))).toBe(false)
  })
})

describe('when the prompt opens', () => {
  it('opens once everything holds and the welcome is over', () => {
    expect(decide({})).toBe('open')
    expect(decide({ day: day({ status: 'ABSENT' }) })).toBe('open')
    // No status from the server (its policy service was down): the punch rules still decide.
    expect(decide({ day: day({ status: null }) })).toBe('open')
  })

  it('waits while the welcome is on screen, and while any answer is still loading', () => {
    expect(decide({ ready: false })).toBe('wait')
    expect(decide({ employee: undefined })).toBe('wait')
    expect(decide({ allowed: undefined })).toBe('wait')
    expect(decide({ day: undefined })).toBe('wait')
  })

  it('never for someone already checked in today (or still in from last night)', () => {
    expect(decide({ day: day({ checkedIn: true }) })).toBe('skip')
    expect(decide({ day: day({ checkedIn: true, status: 'LATE' }) })).toBe('skip')
  })

  it('never when web check-in is off for the company, by the switch or by "Your day"', () => {
    expect(decide({ allowed: false })).toBe('skip')
    expect(decide({ day: day({ webPunchAllowed: false }) })).toBe('skip')
  })

  it('never without an employee record, or when an answer failed or is not available', () => {
    expect(decide({ employee: null })).toBe('skip')
    expect(decide({ employee: { companyId: null } })).toBe('skip')
    expect(decide({ day: null })).toBe('skip')
  })

  it('never on a day with nothing to check in for', () => {
    for (const status of ['ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'NOT_TRACKED']) expect(decide({ day: day({ status }) })).toBe('skip')
  })

  it('never on top of another dialog', () => {
    expect(decide({ otherDialog: true })).toBe('skip')
  })

  it('a definite no settles it before the welcome is over and before the other answers', () => {
    expect(decide({ ready: false, day: day({ checkedIn: true }) })).toBe('skip')
    expect(decide({ ready: false, employee: null, allowed: undefined, day: undefined })).toBe('skip')
    expect(decide({ ready: false, allowed: false, day: undefined })).toBe('skip')
  })
})

/** A browser storage stand-in; `broken` throws on every call (blocked site data, some private windows). */
function fakeStorage(broken = false) {
  const m = new Map<string, string>()
  const fail = () => { throw new Error('SecurityError') }
  return {
    getItem: (k: string) => (broken ? fail() : m.get(k) ?? null),
    setItem: (k: string, v: string) => (broken ? fail() : void m.set(k, v)),
    removeItem: (k: string) => (broken ? fail() : void m.delete(k)),
  }
}
type Globals = { localStorage?: unknown; sessionStorage?: unknown; document?: unknown }
const g = globalThis as unknown as Globals

describe('what this browser remembers', () => {
  beforeEach(() => { g.localStorage = fakeStorage(); g.sessionStorage = fakeStorage() })
  afterEach(() => { delete g.localStorage; delete g.sessionStorage; delete g.document })

  it('"Not now" holds for the rest of that day, for that person only', () => {
    expect(notNowToday('u-not-now', TODAY)).toBe(false)
    saveNotNow('u-not-now', TODAY)
    expect(notNowToday('u-not-now', TODAY)).toBe(true)
    expect(notNowToday('u-not-now', TOMORROW)).toBe(false)
    expect(notNowToday('u-someone-else', TODAY)).toBe(false)
  })

  it('opens at most once per visit and day, per person', () => {
    expect(openedThisVisit('u-visit', TODAY)).toBe(false)
    markOpened('u-visit', TODAY)
    expect(openedThisVisit('u-visit', TODAY)).toBe(true)
    expect(openedThisVisit('u-visit', TOMORROW)).toBe(false)
    expect(openedThisVisit('u-another', TODAY)).toBe(false)
  })

  it('a reload in the same tab remembers it was opened (session storage)', () => {
    g.sessionStorage = fakeStorage()
    ;(g.sessionStorage as ReturnType<typeof fakeStorage>).setItem('ut.punch-prompt.opened:u-reload', TODAY)
    expect(openedThisVisit('u-reload', TODAY)).toBe(true)
  })

  it('with storage blocked nothing throws, and the page still remembers its own visit', () => {
    g.localStorage = fakeStorage(true); g.sessionStorage = fakeStorage(true)
    expect(notNowToday('u-blocked', TODAY)).toBe(false)
    expect(() => saveNotNow('u-blocked', TODAY)).not.toThrow()
    expect(openedThisVisit('u-blocked', TODAY)).toBe(false)
    expect(() => markOpened('u-blocked', TODAY)).not.toThrow()
    expect(openedThisVisit('u-blocked', TODAY)).toBe(true)
  })

  it('with no storage at all (outside a browser) nothing throws either', () => {
    delete g.localStorage; delete g.sessionStorage
    expect(notNowToday('u-none', TODAY)).toBe(false)
    expect(() => saveNotNow('u-none', TODAY)).not.toThrow()
    expect(openedThisVisit('u-none', TODAY)).toBe(false)
  })

  it('sees another open dialog or panel', () => {
    expect(anotherDialogOpen()).toBe(false)
    g.document = { querySelector: (s: string) => (s === '[aria-modal="true"]' ? {} : null) }
    expect(anotherDialogOpen()).toBe(true)
    g.document = { querySelector: () => null }
    expect(anotherDialogOpen()).toBe(false)
  })
})
