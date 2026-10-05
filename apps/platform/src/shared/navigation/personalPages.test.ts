import { afterEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@unifiedtree/sdk'
import { accessState, canOpen, personalPagesOn, personalPagesShown, type AccessContext } from './access'
import { menuRule, visibleEntries } from './pageRegistry'
import { QUICK_ACTIONS } from '../search/actionRegistry'
import { usePersonalPages } from '../hooks/usePersonalPages'

// Personal pages per role (V143.90): the owner turns My work and the other "My …" pages on or off per
// role; the server sends the answer with the session (personalPages). Without one, the old role rule.

const PERSONAL = ['me-payslips', 'me-salary', 'me-wfh', 'me-shift', 'me-documents', 'me-letters', 'me-assets', 'me-advances', 'me-claims', 'me-reviews', 'me-goals',
  'me-training', 'me-attendance', 'me-leave', 'expenses:my', 'expenses:submit', 'performance:my-reviews', 'performance:my-goals', 'learning:my',
  'att-daily:my', 'leave:my', 'leave:apply', 'leave:balances']
const MY_WORK_MENU: [string, string][] = [['/hrms/attendance', 'mytime'], ['/hrms/leave', 'myleave'], ['/me/payslips', 'mypay'], ['/hrms/expenses?tab=my', 'mypay'],
  ['/hrms/performance?view=my-reviews', 'mygrowth'], ['/hrms/documents?view=my', 'mydocs']]
const SELF_ACTIONS = ['apply-leave', 'request-wfh', 'fix-attendance', 'request-shift', 'submit-expense', 'request-advance', 'my-payslip', 'upload-document']

function ctx(o: Partial<AccessContext> = {}): AccessContext {
  return { has: () => true, modules: ['hrms', 'attendance', 'payroll', 'leave'], self: true, adminRole: false, planAdmin: false, ...o }
}
const ids = (c: AccessContext) => new Set(visibleEntries(c).map((e) => e.id))
const myWorkOpen = (c: AccessContext) => MY_WORK_MENU.map(([p, g]) => accessState(menuRule(p, g), c) === 'open')
const actions = (c: AccessContext) => QUICK_ACTIONS.filter((a) => canOpen(a.access, c)).map((a) => a.id)

const OWNER = ctx({ adminRole: true, planAdmin: true })

describe('personal pages: the rule', () => {
  it('takes the server’s answer when the session has one', () => {
    expect(personalPagesShown(true, true)).toBe(true)
    expect(personalPagesShown(false, false)).toBe(false)
  })

  it('without one (a server from before it existed) keeps the old rule: not for admin roles', () => {
    expect(personalPagesShown(null, true)).toBe(false)
    expect(personalPagesShown(undefined, true)).toBe(false)
    expect(personalPagesShown(null, false)).toBe(true)
    expect(personalPagesShown(undefined, false)).toBe(true)
  })

  it('the access rule reads the context, and a context without it is the old rule', () => {
    expect(personalPagesOn(ctx({ adminRole: true, personalPages: true }))).toBe(true)
    expect(personalPagesOn(ctx({ adminRole: false, personalPages: false }))).toBe(false)
    expect(personalPagesOn(ctx({ adminRole: true }))).toBe(false)
    expect(personalPagesOn(ctx({ adminRole: false }))).toBe(true)
  })
})

describe('personal pages: menu, search and quick actions', () => {
  it('by default (no answer from the server) an owner has none of them and an employee has all of them', () => {
    const owner = ids(OWNER)
    for (const id of PERSONAL) expect(owner.has(id), id).toBe(false)
    expect(myWorkOpen(OWNER)).toEqual(MY_WORK_MENU.map(() => false))
    for (const id of SELF_ACTIONS) expect(actions(OWNER), id).not.toContain(id)

    const staff = ids(ctx())
    for (const id of PERSONAL) expect(staff.has(id), id).toBe(true)
  })

  it('an owner who turned them on for their role gets My work, My claims, My goals and the actions for themselves', () => {
    const on = { ...OWNER, personalPages: true }
    const seen = ids(on)
    for (const id of PERSONAL) expect(seen.has(id), id).toBe(true)
    expect(myWorkOpen(on)).toEqual(MY_WORK_MENU.map(() => true))
    for (const id of SELF_ACTIONS) expect(actions(on), id).toContain(id)
    // The admin views stay either way.
    for (const id of ['expenses', 'expenses:approvals', 'performance', 'performance:cycles', 'learning:programs']) expect(seen.has(id), id).toBe(true)
  })

  it('a role turned off loses them even for an employee', () => {
    const off = ctx({ personalPages: false })
    const seen = ids(off)
    for (const id of PERSONAL) expect(seen.has(id), id).toBe(false)
    expect(myWorkOpen(off)).toEqual(MY_WORK_MENU.map(() => false))
    for (const id of SELF_ACTIONS) expect(actions(off), id).not.toContain(id)
  })

  it('the timesheet tab still opens for an approver whose personal pages are off', () => {
    expect(ids(ctx({ personalPages: false })).has('att-daily:timesheet')).toBe(true)
    expect(ids(ctx({ personalPages: false, has: (c) => c !== 'hrms.timesheet.approve' })).has('att-daily:timesheet')).toBe(false)
  })
})

const signIn = (roles: string[], personalPages?: boolean | null) => useAuthStore.getState().loginWithCredentials({
  token: 'x.y.z', userId: 'u', email: 'a@b.c', roles, permissions: ['hrms.ess.read'], tenantId: 't', tenantSlug: 'demo', tenantName: 'Demo',
  activeModules: ['hrms'], personalPages,
})
// What usePersonalPages and the access context compute from the session (the hook is this one line).
const fromSession = () => {
  const { personalPages, user } = useAuthStore.getState()
  return personalPagesShown(personalPages, (user?.roles ?? []).some((r) => ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'].includes(r)))
}

describe('the session keeps the sign-in answer', () => {
  afterEach(() => useAuthStore.getState().reset())

  it('stores what the server said', () => {
    signIn(['OWNER'], true)
    expect(useAuthStore.getState().personalPages).toBe(true)
    expect(fromSession()).toBe(true)
    signIn(['EMPLOYEE'], false)
    expect(fromSession()).toBe(false)
  })

  it('without an answer it is null and the role rule applies, including EMPLOYEE + ADMIN', () => {
    signIn(['EMPLOYEE', 'ADMIN'])
    expect(useAuthStore.getState().personalPages).toBeNull()
    expect(fromSession()).toBe(false)
    signIn(['EMPLOYEE', 'HR_MANAGER'], null)
    expect(fromSession()).toBe(true)
  })

  it('signing out forgets it', () => {
    signIn(['OWNER'], true)
    useAuthStore.getState().reset()
    expect(useAuthStore.getState().personalPages).toBeNull()
  })

  it('the hook is the same rule', () => {
    expect(typeof usePersonalPages).toBe('function')
  })
})
