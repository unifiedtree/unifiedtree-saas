import { describe, expect, it } from 'vitest'
import {
  assetDates, assetMatches, assetPill, countRows, daysBetween, dueLabel, joiningText, offsetOf, progressOf, roleLabel, rowsFromInstances,
  runPill, runStatusLabel, runStatusTone, taskPill, tasksText, usedByText,
} from './onboardingModel'
import type { OnboardingInstance, OnboardingOverviewRow } from './api/useOnboarding'

const TODAY = '2026-10-04' // a Sunday

describe('run status', () => {
  it('labels the three statuses and reads anything else as itself', () => {
    expect(runStatusLabel('IN_PROGRESS')).toBe('In progress')
    expect(runStatusLabel('ON_HOLD')).toBe('On hold')
    expect(runStatusLabel('COMPLETED')).toBe('Completed')
    expect(runStatusLabel('SOME_NEW_STATE')).toBe('Some new state')
    expect(runPill('CANCELLED', null, TODAY)).toEqual({ label: 'Cancelled', tone: 'neutral' })
    expect(runStatusLabel('')).toBe('—')
    expect(runStatusTone('SOME_NEW_STATE')).toBe('neutral')
    expect(runStatusTone('ON_HOLD')).toBe('danger')
  })

  it('says when a hire who has not joined yet starts', () => {
    expect(runPill('IN_PROGRESS', '2026-10-05', TODAY)).toEqual({ label: 'Starts tomorrow', tone: 'warning' })
    expect(runPill('IN_PROGRESS', '2026-10-07', TODAY).label).toBe('Starts Wednesday')
    expect(runPill('IN_PROGRESS', '2026-10-09', TODAY)).toEqual({ label: 'Starts Friday', tone: 'warning' })
    expect(runPill('IN_PROGRESS', '2026-10-12', TODAY)).toEqual({ label: 'Starts 12 Oct', tone: 'warning' })
    // Joined today or earlier, no joining date, or not in progress: the status itself.
    expect(runPill('IN_PROGRESS', TODAY, TODAY).label).toBe('In progress')
    expect(runPill('IN_PROGRESS', '2026-09-28', TODAY).label).toBe('In progress')
    expect(runPill('IN_PROGRESS', null, TODAY).label).toBe('In progress')
    expect(runPill('ON_HOLD', '2026-10-12', TODAY).label).toBe('On hold')
  })

  it('counts days between dates, across months', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1)
    expect(daysBetween(TODAY, TODAY)).toBe(0)
    expect(daysBetween('2026-10-04', '2026-10-01')).toBe(-3)
  })
})

describe('texts', () => {
  it('writes progress in words', () => {
    expect(tasksText(2, 12)).toBe('2 of 12 tasks')
    expect(tasksText(0, 1)).toBe('0 of 1 task')
    expect(tasksText(0, 0)).toBe('No tasks')
  })

  it('writes the joining day, with the year only when it differs', () => {
    expect(joiningText('2026-09-28', TODAY)).toBe('Mon, 28 Sep')
    expect(joiningText('2025-09-29T10:00:00Z', TODAY)).toBe('Mon, 29 Sep 2025')
    expect(joiningText(null, TODAY)).toBe('—')
  })

  it('names roles and due days', () => {
    expect(roleLabel('HR_MANAGER')).toBe('HR manager')
    expect(roleLabel('IT_ADMIN')).toBe('IT admin')
    expect(roleLabel('DEPT_MANAGER')).toBe('Dept manager')
    expect(dueLabel(-3)).toBe('3 days before joining')
    expect(dueLabel(-1)).toBe('1 day before joining')
    expect(dueLabel(0)).toBe('On the joining day')
    expect(dueLabel(2)).toBe('Day 2 after joining')
  })

  it('turns the Add task choice back into the stored offset', () => {
    expect(offsetOf('before', 3)).toBe(-3)
    expect(offsetOf('on', 9)).toBe(0)
    expect(offsetOf('after', 5)).toBe(5)
    // Zero or junk days still mean at least one day before / after.
    expect(offsetOf('after', 0)).toBe(1)
    expect(offsetOf('before', Number.NaN)).toBe(-1)
  })

  it('says how many hires used a template', () => {
    expect(usedByText(undefined)).toBe('—')
    expect(usedByText(0)).toBe('Not used yet')
    expect(usedByText(1)).toBe('1 hire')
    expect(usedByText(46)).toBe('46 hires')
  })
})

describe('tasks', () => {
  it('marks done, skipped, overdue and to do', () => {
    expect(taskPill({ status: 'COMPLETED', dueDate: '2026-09-01' }, TODAY)).toMatchObject({ label: 'Done', closed: true })
    expect(taskPill({ status: 'SKIPPED', dueDate: null }, TODAY)).toMatchObject({ label: 'Skipped', closed: true })
    expect(taskPill({ status: 'PENDING', dueDate: '2026-10-03' }, TODAY)).toMatchObject({ label: 'Overdue', closed: false })
    expect(taskPill({ status: 'PENDING', dueDate: TODAY }, TODAY)).toMatchObject({ label: 'To do', closed: false })
    expect(taskPill({ status: 'PENDING', dueDate: null }, TODAY).label).toBe('To do')
  })

  it('counts done and skipped tasks as finished', () => {
    expect(progressOf([{ status: 'COMPLETED' }, { status: 'SKIPPED' }, { status: 'PENDING' }])).toEqual({ done: 2, total: 3 })
  })
})

describe('assets', () => {
  it('shows two states, as the design does', () => {
    expect(assetPill('ASSIGNED')).toEqual({ label: 'With employee', tone: 'success' })
    expect(assetPill('AVAILABLE').label).toBe('In store')
    expect(assetPill('RETURNED').label).toBe('In store')
    expect(assetPill('LOST').label).toBe('Lost')
    expect(assetMatches('RETURNED', 'store')).toBe(true)
    expect(assetMatches('ASSIGNED', 'store')).toBe(false)
    expect(assetMatches('ASSIGNED', 'with')).toBe(true)
    expect(assetMatches('AVAILABLE', 'all')).toBe(true)
  })

  it('writes the dates column', () => {
    expect(assetDates({ status: 'ASSIGNED', assignedAt: '2022-03-12' })).toBe('Since 12 Mar 2022')
    expect(assetDates({ status: 'RETURNED', returnedAt: '2026-09-18', lastHolderName: 'Deepak Verma' })).toBe('Returned 18 Sep 2026 by Deepak Verma')
    expect(assetDates({ status: 'RETURNED', returnedAt: '2026-09-18' })).toBe('Returned 18 Sep 2026')
    expect(assetDates({ status: 'AVAILABLE' })).toBe('Not handed out yet')
  })
})

describe('the New hires list without the overview endpoint', () => {
  const run = (id: string, status: string, employeeId: string, tasks: { status: string; dueDate: string | null }[]): OnboardingInstance => ({
    id, employeeId, templateId: 't1', status, startedAt: '2026-09-20T05:00:00Z', completedAt: null, createdAt: '2026-09-20T05:00:00Z',
    instanceTasks: tasks.map((t, i) => ({ id: `${id}-${i}`, instanceId: id, taskId: 'x', sequenceNo: i, title: 'T', ownerRole: null, completedBy: null, completedAt: null, notes: null, required: true, ...t })),
  })

  it('builds the same rows and counts the server would', () => {
    const { rows, counts } = rowsFromInstances([
      run('a', 'IN_PROGRESS', 'e1', [{ status: 'PENDING', dueDate: '2026-10-01' }, { status: 'COMPLETED', dueDate: '2026-09-25' }, { status: 'PENDING', dueDate: '2026-10-10' }]),
      run('b', 'ON_HOLD', 'e2', [{ status: 'PENDING', dueDate: '2026-09-01' }]),
      run('c', 'COMPLETED', 'e3', []),
    ], {
      person: (id) => (id === 'e1' ? { name: 'Varun Shetty', code: 'E1', companyId: 'c1', departmentId: 'd1', dateOfJoining: '2026-10-12' } : undefined),
      department: (id) => (id === 'd1' ? 'Engineering' : undefined),
      template: () => 'Engineering onboarding',
    }, TODAY)
    expect(rows[0]).toMatchObject({ instanceId: 'a', employeeName: 'Varun Shetty', departmentName: 'Engineering', templateName: 'Engineering onboarding', tasksTotal: 3, tasksDone: 1, tasksOverdue: 1, nextDueOn: '2026-10-01' })
    // No directory access: no name, never a wrong one.
    expect(rows[1]).toMatchObject({ employeeName: null, departmentName: null, tasksOverdue: 1 })
    // Overdue tasks only count on runs in progress; joining this month comes from the hire's date.
    expect(counts).toEqual({ all: 3, inProgress: 1, onHold: 1, completed: 1, joiningThisMonth: 1, tasksOverdue: 1 })
  })

  it('leaves out a checklist name it does not know, and counts done and skipped on every run', () => {
    const { rows } = rowsFromInstances([
      run('a', 'IN_PROGRESS', 'e1', [{ status: 'COMPLETED', dueDate: '2026-10-01' }, { status: 'SKIPPED', dueDate: null }, { status: 'PENDING', dueDate: '2026-10-02' }, { status: 'PENDING', dueDate: '2026-10-09' }]),
      run('c', 'COMPLETED', 'e3', []),
    ], {
      person: (id) => (id === 'e3' ? { name: 'Karan', dateOfJoining: '2026-08-01' } : undefined),
      department: () => undefined,
      template: () => undefined,
    }, TODAY)
    expect(rows[0]).toMatchObject({ templateName: null, tasksTotal: 4, tasksDone: 2, tasksOverdue: 1, nextDueOn: '2026-10-02' })
    expect(rows[1]).toMatchObject({ employeeName: 'Karan', tasksTotal: 0, nextDueOn: null })
  })

  it('counts an empty list as zeros', () => {
    expect(countRows([] as OnboardingOverviewRow[], TODAY)).toEqual({ all: 0, inProgress: 0, onHold: 0, completed: 0, joiningThisMonth: 0, tasksOverdue: 0 })
  })
})
