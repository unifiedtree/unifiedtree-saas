import { describe, expect, it } from 'vitest'
import { assetDates, assetState, dueOffsetLabel, inStore, instanceState, progressText, roleLabel, statusLabel } from './onboardingModel'

const today = '2026-10-04' // a Sunday

describe('new hire status', () => {
  it('counts down to the joining day', () => {
    expect(instanceState('IN_PROGRESS', '2026-10-05', today)).toEqual({ label: 'Starts tomorrow', tone: 'warning' })
    expect(instanceState('IN_PROGRESS', '2026-10-07', today).label).toBe('Starts Wednesday')
    expect(instanceState('IN_PROGRESS', '2026-10-20', today).label).toBe('Starts 20 Oct')
  })
  it('is in progress from the joining day, or without one', () => {
    expect(instanceState('IN_PROGRESS', today, today)).toEqual({ label: 'In progress', tone: 'info' })
    expect(instanceState('IN_PROGRESS', '2026-09-01', today).label).toBe('In progress')
    expect(instanceState('IN_PROGRESS', null, today).label).toBe('In progress')
  })
  it('reads Done and On hold, and an unknown status as itself', () => {
    expect(instanceState('COMPLETED', null, today)).toEqual({ label: 'Done', tone: 'success' })
    expect(instanceState('ON_HOLD', null, today).label).toBe('On hold')
    expect(instanceState('CANCELLED', null, today)).toEqual({ label: 'Cancelled', tone: 'neutral' })
    expect(statusLabel('COMPLETED')).toBe('Completed')
  })
  it('writes checklist progress', () => {
    expect(progressText(2, 12)).toBe('2 of 12 tasks')
    expect(progressText(1, 1)).toBe('1 of 1 task')
    expect(progressText(0, 0)).toBe('No tasks')
  })
})

describe('template tasks', () => {
  it('fall due before, on or after the joining day', () => {
    expect(dueOffsetLabel(-2)).toBe('2 days before joining')
    expect(dueOffsetLabel(-1)).toBe('1 day before joining')
    expect(dueOffsetLabel(0)).toBe('On the joining day')
    expect(dueOffsetLabel(30)).toBe('Day 30 after joining')
  })
  it('name owner roles in plain words', () => {
    expect(roleLabel('HR_MANAGER')).toBe('HR manager')
    expect(roleLabel('IT_ADMIN')).toBe('IT admin')
    expect(roleLabel('DEPT_MANAGER')).toBe('Dept manager')
  })
})

describe('assets', () => {
  it('keeps Returned apart from In store, and counts both as in store', () => {
    expect(assetState('AVAILABLE').label).toBe('In store')
    expect(assetState('ASSIGNED').label).toBe('With employee')
    expect(assetState('RETURNED').label).toBe('Returned')
    expect(inStore('AVAILABLE') && inStore('RETURNED') && !inStore('ASSIGNED')).toBe(true)
  })
  it('dates the hand-over or the return', () => {
    expect(assetDates({ status: 'ASSIGNED', assignedAt: '2022-03-12' }, today)).toBe('Since 12 Mar 2022')
    expect(assetDates({ status: 'RETURNED', assignedAt: '2026-01-05', returnedAt: '2026-09-18' }, today)).toBe('Returned 18 Sep')
    expect(assetDates({ status: 'AVAILABLE' }, today)).toBe('—')
  })
})
