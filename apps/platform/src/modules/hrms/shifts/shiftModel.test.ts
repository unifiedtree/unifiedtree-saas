import { describe, expect, it } from 'vitest'
import { barSegments, changeDates, peopleWord, shiftProblem, timeRange, workDays } from './shiftModel'

describe('barSegments', () => {
  it('places a day shift on the 24-hour bar', () => {
    expect(barSegments('09:30:00', '18:30:00')).toEqual([{ left: 39.6, width: 37.5 }])
  })
  it('splits an overnight shift at midnight', () => {
    expect(barSegments('22:00', '06:00')).toEqual([{ left: 91.7, width: 8.3 }, { left: 0, width: 25 }])
  })
  it('draws nothing without both times', () => {
    expect(barSegments(null, '18:00')).toEqual([])
  })
})

describe('words', () => {
  it('names the working days from the weekly offs', () => {
    expect(workDays([6, 7])).toBe('Mon–Fri')
    expect(workDays([7])).toBe('Mon–Sat')
    expect(workDays([2, 4, 6, 7])).toBe('Mon, Wed, Fri')
    expect(workDays([])).toBe('Every day')
    expect(workDays(null)).toBeNull()
  })
  it('counts people and formats times', () => {
    expect(peopleWord(1)).toBe('1 person')
    expect(peopleWord(8)).toBe('8 people')
    expect(peopleWord(null)).toBeNull()
    expect(timeRange('09:30:00', '18:30:00')).toBe('09:30–18:30')
  })
  it('says when a change runs', () => {
    expect(changeDates('2026-10-05', null)).toBe('From 5 Oct 2026')
    expect(changeDates('2026-10-05', '2026-10-31')).toBe('5 Oct 2026 – 31 Oct 2026')
  })
})

describe('shiftProblem', () => {
  const ok = { picked: 's1', from: '2026-10-05', until: '', reason: 'Covering a release window', min: '2026-10-02', max: '2027-10-02', scheduled: null }
  it('passes a complete request, with or without Until', () => {
    expect(shiftProblem(ok)).toBeNull()
    expect(shiftProblem({ ...ok, until: '2026-10-31' })).toBeNull()
  })
  it('stops what the server would refuse', () => {
    expect(shiftProblem({ ...ok, picked: null })).toMatch(/Pick a shift/)
    expect(shiftProblem({ ...ok, from: '2026-10-01' })).toMatch(/past/)
    expect(shiftProblem({ ...ok, until: '2026-10-04' })).toMatch(/Until/)
    expect(shiftProblem({ ...ok, reason: 'short' })).toMatch(/10 characters/)
    expect(shiftProblem({ ...ok, scheduled: '2026-10-10' })).toMatch(/already changes/)
  })
})
