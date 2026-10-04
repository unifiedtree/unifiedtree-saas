import { describe, expect, it } from 'vitest'
import {
  FUNNEL, OFFER_NEXT, dayMon, fmtEnum, hireDaysLabel, interviewState, interviewWhen, interviewersLine, istDateOf, istTodayIso,
  mergeInterviews, nextStage, pctLabel, weekdayDay,
} from './hiringModel'
import type { Interview } from '../api/useHiring'

const today = '2026-10-04'

const iv = (over: Partial<Interview> = {}): Interview => ({
  id: 'i-1', candidateId: 'c-1', candidateName: 'Karthik Iyer', candidateStage: 'INTERVIEW', requisitionId: 'r-1', roleTitle: 'Backend',
  title: 'System design', scheduledAt: '2026-10-04T09:30:00Z', scheduledAtIst: '2026-10-04T15:00', durationMinutes: 60, mode: 'VIDEO',
  location: 'https://meet.example/x', criteria: ['Problem solving'], notes: null, status: 'SCHEDULED', interviewers: [], scorecards: [], started: false,
  ...over,
})

describe('stages', () => {
  it('moves one step on, never past Hired or out of an exit', () => {
    expect(nextStage('APPLIED')).toBe('SCREENING')
    expect(nextStage('OFFER')).toBe('HIRED')
    expect(nextStage('HIRED')).toBeNull()
    expect(nextStage('REJECTED')).toBeNull()
    expect(nextStage('WITHDRAWN')).toBeNull()
    expect(FUNNEL).toEqual(['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'])
  })
  it('writes enums as before', () => {
    expect(fmtEnum('FULL_TIME')).toBe('Full Time')
  })
  it('lets only drafts and sent offers change', () => {
    expect(OFFER_NEXT.DRAFT).toEqual(['SENT', 'WITHDRAWN'])
    expect(OFFER_NEXT.SENT).toEqual(['ACCEPTED', 'DECLINED', 'WITHDRAWN'])
    expect(OFFER_NEXT.ACCEPTED).toEqual([])
    expect(OFFER_NEXT.WITHDRAWN).toEqual([])
  })
})

describe('conversion wording', () => {
  it('rounds rates and shows a dash without one', () => {
    expect(pctLabel(0.3571)).toBe('36%')
    expect(pctLabel(1)).toBe('100%')
    expect(pctLabel(0)).toBe('0%')
    expect(pctLabel(null)).toBe('—')
    expect(pctLabel(undefined)).toBe('—')
  })
  it('says the average time to hire in days', () => {
    expect(hireDaysLabel(31.4)).toBe('31 days on average')
    expect(hireDaysLabel(1)).toBe('1 day on average')
    expect(hireDaysLabel(null)).toBe('—')
  })
})

describe('dates', () => {
  it('drops the year in the current year', () => {
    expect(dayMon('2026-09-02', today)).toBe('2 Sep')
    expect(dayMon('2025-12-31', today)).toBe('31 Dec 2025')
    expect(dayMon(null, today)).toBe('—')
  })
  it('names the weekday of a joining date', () => {
    expect(weekdayDay('2026-10-15', today)).toBe('Thu, 15 Oct')
    expect(weekdayDay('2027-01-01', today)).toBe('Fri, 1 Jan 2027')
  })
  it('reads instants in India time', () => {
    expect(istDateOf('2026-10-03T20:00:00Z')).toBe('2026-10-04')
    expect(istTodayIso(new Date('2026-10-03T18:29:00Z'))).toBe('2026-10-03')
    expect(istTodayIso(new Date('2026-10-03T18:31:00Z'))).toBe('2026-10-04')
  })
  it('writes when an interview is', () => {
    expect(interviewWhen(iv(), today)).toBe('Today, 15:00 · 60 min')
    expect(interviewWhen(iv({ scheduledAtIst: '2026-09-28T11:00', durationMinutes: 45 }), today)).toBe('Mon 28 Sep, 11:00 · 45 min')
  })
})

describe('interview status', () => {
  it('is Today or Scheduled before it starts', () => {
    expect(interviewState(iv(), today).label).toBe('Today')
    expect(interviewState(iv({ scheduledAtIst: '2026-10-06T10:00' }), today).label).toBe('Scheduled')
  })
  it('is Cancelled when cancelled', () => {
    expect(interviewState(iv({ status: 'CANCELLED' }), today)).toEqual({ label: 'Cancelled', tone: 'muted' })
  })
  it('after it starts: due until every interviewer filed, for HR', () => {
    const pending = iv({ started: true, interviewers: [{ employeeId: 'a', name: 'A', submitted: true }, { employeeId: 'b', name: 'B', submitted: false }] })
    expect(interviewState(pending, today).label).toBe('Scorecard due')
    const done = iv({ started: true, interviewers: [{ employeeId: 'a', name: 'A', submitted: true }] })
    expect(interviewState(done, today).label).toBe('Scorecard in')
  })
  it('after it starts: due until I filed mine, for an interviewer', () => {
    const others = iv({ started: true, interviewers: [{ employeeId: 'a', name: 'A', submitted: false }] })
    expect(interviewState(others, today, { scorecards: [] }).label).toBe('Scorecard due')
    expect(interviewState(others, today, { scorecards: [{ id: 's' } as never] }).label).toBe('Scorecard in')
  })
  it('ticks the interviewers who filed', () => {
    expect(interviewersLine(iv({ interviewers: [{ employeeId: 'a', name: 'Siddharth Rao', submitted: true }, { employeeId: 'b', name: 'Priya Sharma', submitted: false }] })))
      .toBe('Siddharth Rao ✓, Priya Sharma')
  })
})

describe('the Coming up rows', () => {
  it('lists each interview once, oldest first, keeping the interviewer’s own copy', () => {
    const a = iv({ id: 'a', scheduledAt: '2026-10-05T09:00:00Z' })
    const b = iv({ id: 'b', scheduledAt: '2026-10-02T09:00:00Z', started: true })
    const bMine = { ...b, scorecards: [] }
    const rows = mergeInterviews([a, b], [bMine])
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
    expect(rows[0].interview).toBe(b)
    expect(rows[0].mine).toBe(bMine)
    expect(rows[1].mine).toBeNull()
  })
  it('includes the interviewer’s past interviews that HR’s list no longer has', () => {
    const old = iv({ id: 'old', started: true })
    const rows = mergeInterviews([], [old])
    expect(rows).toHaveLength(1)
    expect(rows[0].interview).toBe(old)
    expect(rows[0].mine).toBe(old)
  })
})
