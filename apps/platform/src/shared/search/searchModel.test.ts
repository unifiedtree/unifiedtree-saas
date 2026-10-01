import { describe, expect, it } from 'vitest'
import type { AccessContext } from '../navigation/access'
import { visibleEntries } from '../navigation/pageRegistry'
import { canOpen } from '../navigation/access'
import { QUICK_ACTIONS } from './actionRegistry'
import type { GlobalSearchGroup } from './useGlobalSearch'
import {
  PERSON_RECENT, badgeTone, buildResults, jumpRows, pageItems, personFacts, personRole, quickTiles, searchHints, type JumpModule,
} from './searchModel'

const ctx = (perms: string[], extra: Partial<AccessContext> = {}): AccessContext => ({
  has: (c) => perms.includes(c), modules: ['hrms', 'payroll'], self: true, adminRole: false, planAdmin: false, ...extra,
})
const HR = ['hrms.employee.read', 'attendance.team.read', 'hrms.leave.approve.l1', 'hrms.leave.read', 'leave.request.self', 'payroll.runs.read', 'payroll.runs.manage', 'hrms.report.headcount']
const EMP = ['attendance.checkin.self', 'hrms.ess.read', 'leave.request.self', 'hrms.leave.read', 'payroll.payslip.read.self', 'hrms.document.read.self']

const server: GlobalSearchGroup[] = [
  { type: 'employee', label: 'People', items: [{ type: 'employee', id: 'e1', title: 'Reader User', subtitle: 'EMP002 · Sales', url: '/hrms/employees?q=reader' }] },
  { type: 'leave', label: 'Leave', items: [{ type: 'leave', id: 'l1', title: 'Casual leave', subtitle: '1 Oct', url: '/hrms/leave?tab=my', badge: 'Pending' }] },
  { type: 'payslip', label: 'Payslips', items: [{ type: 'payslip', id: 'p1', title: 'Payslip · August 2026', url: '/me/payslips' }, { type: 'payslip', id: 'p2', title: 'Payslip · July 2026', url: '/me/payslips' }] },
]

function input(perms: string[], query: string, scope: 'all' | 'people' | 'pages' | 'actions' | 'records' = 'all', extra: Partial<AccessContext> = {}) {
  const c = ctx(perms, extra)
  return {
    query, scope, pages: pageItems(visibleEntries(c)), actions: QUICK_ACTIONS.filter((a) => canOpen(a.access, c)),
    server, modules: c.modules,
  }
}

describe('search results', () => {
  it('lists people, pages, actions, then the records, each under its own group', () => {
    const r = buildResults(input(HR, 'leave'))
    expect(r.groups.map((g) => g.key)).toEqual(['employee', 'page', 'action', 'leave', 'payslip'])
    expect(r.groups[0].rows[0]).toMatchObject({ kind: 'person', path: '/hrms/employees?q=reader', personId: 'e1' })
    expect(r.groups.find((g) => g.key === 'leave')!.rows[0].badge).toEqual({ tone: 'warning', text: 'Pending' })
  })
  it('caps each group as the design does in All', () => {
    const r = buildResults(input(HR, 'a'))
    expect(r.groups.find((g) => g.key === 'page')!.rows.length).toBeLessThanOrEqual(6)
    expect(r.groups.find((g) => g.key === 'action')?.rows.length ?? 0).toBeLessThanOrEqual(4)
  })
  it('counts every scope, and a scope shows only its own rows', () => {
    const all = buildResults(input(HR, 'leave'))
    expect(all.counts.people).toBe(1)
    expect(all.counts.records).toBe(3)
    expect(all.counts.all).toBe((all.counts.people ?? 0) + (all.counts.pages ?? 0) + (all.counts.actions ?? 0) + 3)
    expect(all.hasRecords).toBe(true)
    expect(buildResults(input(HR, 'leave', 'people')).groups.map((g) => g.key)).toEqual(['employee'])
    expect(buildResults(input(HR, 'leave', 'records')).groups.map((g) => g.key)).toEqual(['leave', 'payslip'])
    expect(buildResults(input(HR, 'leave', 'pages')).groups.map((g) => g.key)).toEqual(['page'])
  })
  it('shows no numbers before anything is typed', () => {
    expect(buildResults(input(HR, '')).counts.all).toBeNull()
  })
  it('never lists a page or action the person can’t open', () => {
    const r = buildResults(input(EMP, 'payroll'))
    const paths = r.groups.flatMap((g) => g.rows).filter((x) => x.kind !== 'record' && x.kind !== 'person').map((x) => x.path)
    expect(paths.some((p) => p.startsWith('/hrms/payroll'))).toBe(false)
    expect(buildResults(input(EMP, 'add employee')).groups.flatMap((g) => g.rows).some((x) => x.key === 'action:add-employee')).toBe(false)
  })
  it('hides records behind a module the workspace doesn’t have', () => {
    const r = buildResults({ ...input(HR, 'leave'), modules: ['hrms'] })
    expect(r.groups.some((g) => g.key === 'payslip')).toBe(false)
  })
  it('offers "On this page" only where the page reads ?q=', () => {
    expect(buildResults({ ...input(HR, 'reader'), onThisPage: { label: 'Workforce directory', path: '' } }).groups[0].key).toBe('filter')
    expect(buildResults(input(HR, 'reader')).groups.some((g) => g.key === 'filter')).toBe(false)
    expect(buildResults({ ...input(HR, 'reader', 'people'), onThisPage: { label: 'X', path: '' } }).groups.some((g) => g.key === 'filter')).toBe(false)
  })
  it('gives a page its tabs for the preview', () => {
    const leave = pageItems(visibleEntries(ctx(HR))).find((p) => p.path === '/hrms/leave')
    expect(leave?.tabs).toContain('Leave approvals')
    const empLeave = pageItems(visibleEntries(ctx(EMP))).find((p) => p.path === '/hrms/leave')
    expect(empLeave?.tabs ?? []).not.toContain('Leave approvals')
  })
})

describe('empty dialog', () => {
  it('offers at most six quick actions, all allowed', () => {
    const allowed = QUICK_ACTIONS.filter((a) => canOpen(a.access, ctx(EMP)))
    const tiles = quickTiles(allowed)
    expect(tiles.length).toBeLessThanOrEqual(6)
    expect(tiles.map((t) => t.id)).not.toContain('run-payroll')
  })
  it('puts the company’s actions first for an admin home', () => {
    const allowed = QUICK_ACTIONS.filter((a) => canOpen(a.access, ctx([...HR, ...EMP])))
    expect(quickTiles(allowed)[0].id).toBe('apply-leave')
    const admin = quickTiles(allowed, true)
    expect(admin[0].id).not.toBe('apply-leave')
    expect(admin.map((t) => t.id)).toContain('run-payroll')
  })
  it('jumps to the first page of the first rail modules, skipping business apps and Soon', () => {
    const mods: JumpModule[] = [
      { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'home', pages: [{ label: 'Dashboard', path: '/dashboard' }] },
      { key: 'crm', label: 'CRM', icon: 'cart', group: 'apps', pages: [{ label: 'CRM', path: '/crm' }] },
      { key: 'soon', label: 'Soon', icon: 'x', group: 'people', soon: true, pages: [{ label: 'S', path: '/s' }] },
      { key: 'leave', label: 'Leave', icon: 'calendar', group: 'time', pages: [{ label: 'Leave Operations', path: '/hrms/leave' }, { label: 'Other', path: '/x' }] },
    ]
    expect(jumpRows(mods, () => undefined).map((r) => [r.label, r.sub, r.path])).toEqual([['Dashboard', 'Dashboard', '/dashboard'], ['Leave Operations', 'Leave', '/hrms/leave']])
    expect(jumpRows(mods, () => undefined, 1)).toHaveLength(1)
  })
})

describe('search pill words', () => {
  it('follow the permissions', () => {
    expect(searchHints(ctx(HR), true)).toEqual(['people', 'payslips', 'leave requests', 'reports', 'pages', 'quick actions'])
    expect(searchHints(ctx(EMP), true)).toEqual(['payslips', 'leave requests', 'documents', 'pages', 'quick actions'])
    expect(searchHints(ctx(EMP, { modules: ['hrms'] }), false)).toEqual(['leave requests', 'documents', 'pages'])
  })
})

describe('people', () => {
  it('builds the preview facts from what is known only', () => {
    expect(personFacts(undefined)).toEqual([])
    expect(personFacts({ employeeCode: 'EMP002' })).toEqual([{ k: 'Code', v: 'EMP002' }])
    expect(personFacts({ employeeCode: 'EMP002', branchName: 'Pune', managerName: 'Dept Manager', dateOfJoining: '2024-03-01' }).map((f) => f.k))
      .toEqual(['Code', 'Branch', 'Reports to', 'Joined'])
    expect(personRole({ jobTitle: 'Engineer', departmentName: 'Sales' })).toBe('Engineer · Sales')
    expect(personRole({ departmentName: 'Sales' })).toBe('Sales')
  })
  it('keeps a person in Recent only as a profile or a filtered directory', () => {
    expect(PERSON_RECENT.test('/hrms/employees/22222222-2222-2222-2222-222222222222')).toBe(true)
    expect(PERSON_RECENT.test('/hrms/employees?q=reader')).toBe(true)
    expect(PERSON_RECENT.test('/hrms/payroll/runs/x')).toBe(false)
  })
  it('tones record statuses', () => {
    expect(badgeTone('Rejected')).toBe('danger')
    expect(badgeTone('Awaiting HR')).toBe('warning')
    expect(badgeTone('Verified')).toBe('success')
    expect(badgeTone('Something')).toBe('neutral')
  })
})
