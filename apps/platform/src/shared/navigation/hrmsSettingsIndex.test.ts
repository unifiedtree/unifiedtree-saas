import { describe, expect, it } from 'vitest'
import { accessState, type AccessContext } from './access'
import { PAGE_REGISTRY, visibleEntries } from './pageRegistry'
import { HRMS_SETTINGS_INDEX, HRMS_SETTING_IDS, HRMS_SETTINGS_PATH, hrmsSettingsFor } from './hrmsSettingsIndex'

function ctx(perms: string[], o: Partial<AccessContext> = {}): AccessContext {
  const set = new Set(perms)
  return { has: (c) => set.has('*') || set.has(c), modules: ['hrms', 'attendance', 'payroll', 'leave'], self: true, adminRole: false, planAdmin: false, ...o }
}
/** What the page does: the registry entries open for this person, by id → path. */
const cardsFor = (c: AccessContext) =>
  hrmsSettingsFor(new Map(visibleEntries(c).filter((e) => e.state === 'open').map((e) => [e.id, e.path])), c.has)
const cardIds = (c: AccessContext) => cardsFor(c).flatMap((g) => g.cards.map((x) => x.id))
const index = () => PAGE_REGISTRY.find((e) => e.id === 'hrms-settings')!

describe('HRMS Settings index (Q-06)', () => {
  it('links only to live registry pages, each once, and moves nothing', () => {
    for (const id of HRMS_SETTING_IDS) expect(PAGE_REGISTRY.some((e) => e.id === id), id).toBe(true)
    expect(new Set(HRMS_SETTING_IDS).size).toBe(HRMS_SETTING_IDS.length)
    // Every card opens the page where the setting already lives: never the index itself.
    expect(HRMS_SETTING_IDS).not.toContain('hrms-settings')
    expect(index().path).toBe(HRMS_SETTINGS_PATH)
  })

  it('the owner sees every card, in its group', () => {
    expect(cardIds(ctx(['*']))).toEqual(HRMS_SETTING_IDS)
    expect(cardsFor(ctx(['*'])).map((g) => g.key)).toEqual(HRMS_SETTINGS_INDEX.map((g) => g.key))
  })

  it('an HR person sees only the settings their role opens', () => {
    const hr = ctx(['hrms.branch.read', 'payroll.settings.read', 'settings.holidays.write', 'leave.type.write'])
    const ids = cardIds(hr)
    expect(ids).toEqual(expect.arrayContaining(['companies', 'pay-settings', 'm-statutory', 'm-leave-rules']))
    expect(ids).not.toContain('notif-templates')
    expect(ids).not.toContain('m-grades')
    // A card shows exactly when its own page would open.
    for (const id of ids) expect(accessState(PAGE_REGISTRY.find((e) => e.id === id)!.access, hr)).toBe('open')
  })

  it('pages everyone may read (holidays, policies, schedules) are cards only for those who change them', () => {
    const manager = ctx(['attendance.team.read', 'hrms.policy.read', 'hrms.ess.read'])
    expect(cardIds(manager)).toEqual([])
    expect(cardIds(ctx(['settings.holidays.write', 'hrms.leave.read', 'hrms.policy.write', 'attendance.workforce.admin', 'attendance.team.read'])))
      .toEqual(expect.arrayContaining(['leave:holidays', 'policies', 'att-shifts:schedules']))
  })

  it('an employee has no HR settings, so no index either', () => {
    const employee = ctx(['attendance.checkin.self', 'hrms.ess.read', 'hrms.policy.acknowledge.self', 'leave.request.self'])
    expect(cardIds(employee)).toEqual([])
    expect(accessState(index().access, employee)).toBe('hidden')
  })

  it('the index opens when any one card opens', () => {
    expect(accessState(index().access, ctx(['hrms.notiftemplate.read']))).toBe('open')
    expect(cardIds(ctx(['hrms.notiftemplate.read']))).toEqual(['notif-templates'])
  })

  it('without the HRMS module it is offered to plan admins only (locked), like every HRMS page', () => {
    const noHr = { modules: ['attendance'] }
    expect(accessState(index().access, ctx(['*'], { ...noHr, planAdmin: true }))).toBe('locked')
    expect(accessState(index().access, ctx(['*'], noHr))).toBe('hidden')
  })
})
