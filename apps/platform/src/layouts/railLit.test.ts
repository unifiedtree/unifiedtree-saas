import { afterEach, describe, expect, it, vi } from 'vitest'
import { litRailKey, railViaOn, railViaTo, readRailVia, saveRailVia, type ActiveRailItem } from './railLit'

// The rule before this change: the first active item with more than one page, else the first active item.
const before = (active: ActiveRailItem[]) => (active.find(i => i.tabs > 1) ?? active[0])?.key

// Active rail items (rail order) a Dept Manager has on each page.
const LEAVE_PAGE: ActiveRailItem[] = [{ key: 'leave', tabs: 1 }, { key: 'ess', tabs: 9 }]
const ATTENDANCE_PAGE: ActiveRailItem[] = [{ key: 'attendance', tabs: 3 }, { key: 'ess', tabs: 9 }]
const TEAM_PAGE: ActiveRailItem[] = [{ key: 'myteam', tabs: 0 }, { key: 'ess', tabs: 9 }]
const ME_PAGE: ActiveRailItem[] = [{ key: 'ess', tabs: 9 }]

describe('which rail item is lit', () => {
  it('a manager clicking Leave gets Leave, not Me', () => {
    expect(before(LEAVE_PAGE)).toBe('ess') // the reported bug
    expect(litRailKey(LEAVE_PAGE, 'leave')).toBe('leave')
  })

  it('Me → its Leave tab keeps Me lit', () => {
    expect(litRailKey(LEAVE_PAGE, 'ess')).toBe('ess')
  })

  it('a fresh /hrms/leave (no rail item to go on) lights Leave', () => {
    expect(litRailKey(LEAVE_PAGE, null)).toBe('leave')
    expect(litRailKey(LEAVE_PAGE)).toBe('leave')
  })

  it('/me lights Me, with or without a remembered item', () => {
    expect(litRailKey(ME_PAGE, null)).toBe('ess')
    expect(litRailKey(ME_PAGE, 'ess')).toBe('ess')
    expect(litRailKey(ME_PAGE, 'leave')).toBe('ess')
    // An employee whose "My workspace" link and Me group both own /me: the group with tabs.
    expect(litRailKey([{ key: 'myworkspace', tabs: 0 }, { key: 'ess', tabs: 9 }], null)).toBe('ess')
  })

  it('Team lights Team, clicked or fresh; Me → Team attendance keeps Me', () => {
    expect(litRailKey(TEAM_PAGE, 'myteam')).toBe('myteam')
    expect(litRailKey(TEAM_PAGE, null)).toBe('myteam')
    expect(litRailKey(TEAM_PAGE, 'ess')).toBe('ess')
  })

  it('Attendance follows the same rule', () => {
    expect(litRailKey(ATTENDANCE_PAGE, 'attendance')).toBe('attendance')
    expect(litRailKey(ATTENDANCE_PAGE, 'ess')).toBe('ess')
    expect(litRailKey(ATTENDANCE_PAGE, null)).toBe('attendance')
    // An employee's Attendance group may list one page: still Attendance, not Me.
    expect(litRailKey([{ key: 'attendance', tabs: 1 }, { key: 'ess', tabs: 9 }], null)).toBe('attendance')
  })

  it('a remembered item that does not own the page falls back', () => {
    expect(litRailKey(LEAVE_PAGE, 'dashboard')).toBe('leave')
    expect(litRailKey(ME_PAGE, 'myteam')).toBe('ess')
    expect(litRailKey([{ key: 'performance', tabs: 2 }], 'ess')).toBe('performance')
  })

  it('without a Me item (admins) the rule is unchanged', () => {
    const sets: ActiveRailItem[][] = [
      [{ key: 'leave', tabs: 1 }],
      [{ key: 'attendance', tabs: 3 }],
      [{ key: 'dashboard', tabs: 0 }],
      [{ key: 'hrsettings', tabs: 12 }],
      [],
    ]
    for (const s of sets) expect(litRailKey(s, null)).toBe(before(s))
  })

  it('a page two other items own keeps the old rule (the one with tabs first)', () => {
    const letters: ActiveRailItem[] = [{ key: 'recruit', tabs: 5 }, { key: 'ess', tabs: 9 }]
    expect(litRailKey(letters, null)).toBe('recruit')
    const two: ActiveRailItem[] = [{ key: 'a', tabs: 1 }, { key: 'b', tabs: 3 }]
    expect(litRailKey(two, null)).toBe(before(two))
    expect(litRailKey(two, null)).toBe('b')
    const twoFlat: ActiveRailItem[] = [{ key: 'a', tabs: 0 }, { key: 'b', tabs: 1 }]
    expect(litRailKey(twoFlat, null)).toBe('a')
    // A click on either still lights that one.
    expect(litRailKey(two, 'a')).toBe('a')
  })
})

describe('a click counts only on the page it opened', () => {
  it('holds on that page, its own tabs (?tab=) and pages under it', () => {
    const meLeave = railViaTo('ess', '/hrms/leave')
    expect(railViaOn(meLeave, '/hrms/leave')).toBe('ess')
    expect(railViaOn(railViaTo('ess', '/hrms/leave?tab=my'), '/hrms/leave')).toBe('ess')
    expect(railViaOn(railViaTo('attendance', '/hrms/attendance'), '/hrms/attendance/manual-entry')).toBe('attendance')
  })

  it('ends on any other page: a dashboard card, a link on the page, search, a notification, Back', () => {
    // Me → Leave, then a load of /dashboard: its "Open leave approvals" card lights Leave, not Me.
    const meLeave = railViaTo('ess', '/hrms/leave')
    expect(railViaOn(meLeave, '/dashboard')).toBeNull()
    // Me → Team attendance, then the Team page's "Team attendance" button: Attendance, not Me.
    expect(litRailKey(ATTENDANCE_PAGE, railViaOn(railViaTo('ess', '/team'), '/hrms/attendance'))).toBe('attendance')
    // Me, then search, a notification or Back (Leave → Me → Back) opens Leave: Leave.
    expect(litRailKey(LEAVE_PAGE, railViaOn(railViaTo('ess', '/me'), '/hrms/leave'))).toBe('leave')
    // A path that only starts the same is another page.
    expect(railViaOn(railViaTo('ess', '/me'), '/messages')).toBeNull()
    expect(railViaOn(null, '/hrms/leave')).toBeNull()
  })

  it('Me → Leave, and a refresh there, keeps Me lit', () => {
    expect(litRailKey(LEAVE_PAGE, railViaOn(railViaTo('ess', '/hrms/leave'), '/hrms/leave'))).toBe('ess')
    expect(litRailKey(LEAVE_PAGE, railViaOn(railViaTo('leave', '/hrms/leave'), '/hrms/leave'))).toBe('leave')
  })
})

describe('remembering the rail item for this browser tab', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('keeps it in session storage', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } })
    expect(readRailVia()).toBeNull()
    saveRailVia(railViaTo('ess', '/hrms/leave'))
    expect(readRailVia()).toEqual({ key: 'ess', path: '/hrms/leave' })
    saveRailVia(null)
    expect(readRailVia()).toBeNull()
    // Anything else stored under the key is ignored.
    for (const bad of ['leave', '"leave"', '{"key":"leave"}', '42', 'null']) {
      store.set('ut:rail-via', bad)
      expect(readRailVia()).toBeNull()
    }
  })

  it('works without storage (private mode, blocked site data)', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    expect(() => saveRailVia(railViaTo('leave', '/hrms/leave'))).not.toThrow()
    expect(() => saveRailVia(null)).not.toThrow()
    expect(readRailVia()).toBeNull()
  })
})
