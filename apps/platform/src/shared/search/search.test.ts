import { describe, expect, it } from 'vitest'
import { matchItem, rank, editDistance, highlightRanges } from './rank'
import { buildSlashTargets, suggestSlash, seg } from './slash'
import { pushRecent, type RecentItem } from './recent'
import { QUICK_ACTIONS } from './actionRegistry'
import { canOpen, type AccessContext } from '../navigation/access'
import { visibleEntries } from '../navigation/pageRegistry'

const item = (label: string, keywords: string[] = [], description = '') => ({ id: label, label, keywords, description })

describe('matching', () => {
  it('ranks exact, prefix, word and substring matches in that order', () => {
    const items = [item('Leave balances'), item('Sickleave cover'), item('Leave'), item('My leave requests')]
    expect(rank(items, 'leave').map((i) => i.label)).toEqual(['Leave', 'Leave balances', 'My leave requests', 'Sickleave cover'])
  })
  it('forgives typos and partial words', () => {
    expect(matchItem(item('Attendance Analytics'), 'attendence').score).toBeGreaterThan(0)
    expect(matchItem(item('Payroll dashboard'), 'payrol dash').score).toBeGreaterThan(0)
    expect(matchItem(item('Attendance Analytics'), 'atnd').score).toBeGreaterThan(0)
    expect(matchItem(item('Holidays'), 'zzz').score).toBe(0)
  })
  it('matches initials and keywords', () => {
    expect(matchItem(item('Work from home'), 'wfh').score).toBeGreaterThan(0)
    expect(matchItem(item('Regularization', ['missed punch']), 'missed').score).toBeGreaterThan(0)
  })
  it('returns the label ranges to highlight', () => {
    expect(matchItem(item('Daily Logs'), 'log').ranges).toEqual([[6, 9]])
    expect(matchItem(item('Leave'), 'lea').ranges).toEqual([[0, 3]])
    expect(highlightRanges('Rahul Verma', 'rah ver')).toEqual([[0, 3], [6, 9]])
  })
  it('caps the edit distance', () => {
    expect(editDistance('attendence', 'attendance')).toBe(1)
    expect(editDistance('ab', 'ba')).toBe(1)
    expect(editDistance('payroll', 'zzzzzzz', 2)).toBe(3)
  })
})

const HR = new Set(['attendance.team.read', 'attendance.checkin.self', 'hrms.leave.read', 'leave.request.self', 'hrms.leave.approve.l1', 'hrms.branch.read', 'hrms.employee.read', 'org.geofence.write'])
const EMP = new Set(['attendance.checkin.self', 'hrms.ess.read', 'leave.request.self', 'hrms.leave.read'])
const ctx = (perms: Set<string>): AccessContext => ({ has: (c) => perms.has(c), modules: ['hrms', 'payroll'], self: true, adminRole: false, planAdmin: false })

describe('"/" navigation', () => {
  const hr = buildSlashTargets(visibleEntries(ctx(HR)))
  const emp = buildSlashTargets(visibleEntries(ctx(EMP)))
  const top = (q: string, t = hr) => suggestSlash(q, t)[0]?.target.path

  it('normalises segments', () => {
    expect(seg('Daily Logs')).toBe('dailylogs')
    expect(seg('daily-tracking')).toBe('dailytracking')
  })
  it('opens an area at the first page the person may open', () => {
    expect(top('/attendance')).toBe('/hrms/att-analytics')
    expect(top('/attendance', emp)).toBe('/hrms/attendance')
    expect(top('/att')).toBe('/hrms/att-analytics')
  })
  it('opens an exact page or tab, however it is typed', () => {
    expect(top('/attendance/dailytracking')).toBe('/hrms/attendance')
    expect(top('/attendance/daily-tracking')).toBe('/hrms/attendance')
    expect(top('/attendance/daily logs')).toBe('/hrms/attendance?tab=team')
    expect(top('/attendance/regularization')).toBe('/hrms/attendance?tab=corrections')
    expect(top('/leave/approvals')).toBe('/hrms/leave?tab=approvals')
    expect(top('/hrms/leave')).toBe('/hrms/leave')
  })
  it('never suggests what the person can’t open', () => {
    expect(suggestSlash('/attendance/daily-logs', emp).some((h) => h.target.path.includes('tab=team'))).toBe(false)
    expect(suggestSlash('/leave/approvals', emp).some((h) => h.target.path.includes('approvals'))).toBe(false)
  })
  it('sends the retired geofencing path to Companies & Branches', () => {
    expect(top('/attendance/geofencing')).toBe('/hrms/companies')
    expect(top('/geofence')).toBe('/hrms/companies')
  })
  it('lists the areas for a bare "/" and the pages under "area/"', () => {
    expect(suggestSlash('/', hr).every((h) => h.target.id.startsWith('area:'))).toBe(true)
    const under = suggestSlash('/attendance/', hr)
    expect(under.length).toBeGreaterThan(2)
    expect(under.every((h) => h.shown.startsWith('/attendance/'))).toBe(true)
  })
})

describe('actions and recents', () => {
  it('offers only actions the person can complete', () => {
    const allowed = QUICK_ACTIONS.filter((a) => canOpen(a.access, ctx(EMP))).map((a) => a.id)
    expect(allowed).toContain('apply-leave')
    expect(allowed).not.toContain('run-payroll')
    expect(allowed).not.toContain('add-employee')
    expect(allowed).not.toContain('set-punch-zone')
  })
  it('keeps the newest recents first without duplicates', () => {
    const a: RecentItem = { kind: 'page', id: 'a', label: 'A', path: '/a', at: 1 }
    const b: RecentItem = { kind: 'page', id: 'b', label: 'B', path: '/b', at: 2 }
    expect(pushRecent(pushRecent([a], b), { ...a, at: 3 }).map((r) => r.path)).toEqual(['/a', '/b'])
  })
})
