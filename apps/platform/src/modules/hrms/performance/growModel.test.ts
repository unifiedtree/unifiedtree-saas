import { describe, expect, it } from 'vitest'
import {
  certificationState, currentCycle, cycleStatus, cycleSteps, dayMon, daysLeft, fnfState, kindWords, myCycleSteps,
  periodLabel, personStatus, ratingText, ratingWord, reviewStatus, skillWord,
} from './growModel'
import type { PerformanceReview, ReviewCycle } from '../api/usePerformance'
import type { CycleStages } from '../api/usePerformanceAdmin'

const today = '2026-10-02'
const ms = (over = {}) => ({ goalsBy: null, selfReviewBy: null, managerReviewBy: null, shareOn: null, holdUntilShared: false, sharedAt: null, ...over })

describe('dates', () => {
  it('drops the year in the current year', () => {
    expect(dayMon('2026-09-30', today)).toBe('Wed, 30 Sep')
    expect(dayMon('2025-12-31', today)).toBe('Wed, 31 Dec 2025')
    expect(dayMon(null)).toBe('—')
  })
  it('names a period by months', () => {
    expect(periodLabel('2026-07-01', '2026-09-30')).toBe('Jul – Sep 2026')
    expect(periodLabel('2026-10-01', '2027-03-31')).toBe('Oct 2026 – Mar 2027')
    expect(periodLabel(null, null)).toBe('Not set')
  })
})

describe('ratings', () => {
  it('uses the admin words and keeps decimals', () => {
    expect(ratingWord(4.6)).toBe('Exceeds')
    expect(ratingWord(5)).toBe('Outstanding')
    expect(ratingWord(0)).toBe('Below')
    expect(ratingText(4.6)).toBe('4.6 · Exceeds')
    expect(ratingText(null)).toBe('Not rated yet')
  })
  it('names review statuses', () => {
    expect(reviewStatus('PENDING').label).toBe('Waiting')
    expect(reviewStatus('IN_PROGRESS').label).toBe('Draft saved')
    expect(reviewStatus('MISSED').tone).toBe('danger')
  })
})

describe('cycles', () => {
  const c = (over: Partial<ReviewCycle>): ReviewCycle => ({ id: 'x', companyId: 'c', name: 'n', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00Z', ...over })
  it('follows the open cycle that started last', () => {
    expect(currentCycle([c({ id: 'a', periodStart: '2026-01-01' }), c({ id: 'b', periodStart: '2026-07-01' }), c({ id: 'd', status: 'DRAFT', periodStart: '2026-10-01' })])?.id).toBe('b')
    expect(currentCycle([c({ id: 'd', status: 'DRAFT' }), c({ id: 'e', status: 'CLOSED' })])?.id).toBe('d')
    expect(currentCycle([])).toBeNull()
  })
  it('says when an open cycle closes', () => {
    expect(cycleStatus(c({ periodEnd: '2026-09-30' }), today).label).toBe('Open · closes 30 Sep')
    expect(cycleStatus(c({ milestones: ms({ managerReviewBy: '2026-10-09' }) }), today).label).toBe('Open · closes 9 Oct')
    expect(cycleStatus(c({ status: 'DRAFT' }), today).label).toBe('Planned')
  })
  it('works out the stages from counts and dates', () => {
    const stages: CycleStages = {
      cycleId: 'x', name: 'Q3', status: 'ACTIVE', reviewees: 3,
      rows: [{ reviewerType: 'SELF', total: 3, submitted: 3, waiting: 0, missed: 0 }, { reviewerType: 'MANAGER', total: 3, submitted: 1, waiting: 2, missed: 0 }],
      milestones: ms({ goalsBy: '2026-07-31', managerReviewBy: '2026-10-09', shareOn: '2026-10-16', holdUntilShared: true }),
    }
    const s = cycleSteps(stages, today)
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'current', 'todo', 'todo'])
    expect(s[2].meta).toBe('1 of 3')
    expect(s[4].meta).toBe('From Fri, 16 Oct')
    const shared = cycleSteps({ ...stages, milestones: ms({ sharedAt: '2026-10-01T10:00:00Z' }), rows: stages.rows.map((r) => ({ ...r, submitted: r.total, waiting: 0 })) }, today)
    expect(shared.every((x) => x.state === 'done')).toBe(true)
  })
  it('my steps: self-review next, then the manager, then sharing', () => {
    const steps = myCycleSteps({ goals: 2, selfReview: { status: 'PENDING' }, managerReview: { status: 'PENDING', reviewerName: 'Dept Manager' }, feedbackHeld: true, milestones: ms({ selfReviewBy: '2026-10-05' }) }, today)
    expect(steps.map((x) => x.state)).toEqual(['done', 'current', 'todo', 'todo'])
    expect(steps[1].meta).toBe('Due Mon, 5 Oct')
    expect(steps[2].label).toBe('Dept’s review')
    expect(steps[3].meta).toBe('When HR shares it')
  })
})

describe('kind words', () => {
  const r = (over: Partial<PerformanceReview>): PerformanceReview => ({ id: Math.random().toString(), cycleId: 'c', employeeId: 'me', reviewerId: 'm', status: 'SUBMITTED', createdAt: '', ...over })
  it('quotes strengths others wrote about me, newest first', () => {
    const words = kindWords([
      r({ strengths: 'Calm on the incident', reviewerName: 'Dept Manager', submittedAt: '2026-09-18T10:00:00Z' }),
      r({ strengths: 'Self praise', reviewerId: 'me' }),
      r({ strengths: 'Not yet', status: 'PENDING' }),
      r({ strengths: '  ' }),
      r({ strengths: 'About someone else', employeeId: 'other' }),
      r({ strengths: 'Paired well', reviewerName: 'Kavya', submittedAt: '2026-09-20T10:00:00Z' }),
    ], 'me')
    expect(words.map((w) => w.quote)).toEqual(['Paired well', 'Calm on the incident'])
    expect(kindWords([], undefined)).toEqual([])
  })
})

describe('people, learning and exit', () => {
  it('people status', () => {
    expect(personStatus({ pendingInOpenCycle: true }).label).toBe('Review due')
    expect(personStatus({ employmentStatus: 'PROBATION' }).label).toBe('On probation')
    expect(personStatus({ employmentStatus: 'ACTIVE', lastReviewStatus: 'SUBMITTED' }).label).toBe('Reviewed')
  })
  it('skill words and certification states', () => {
    expect([1, 2, 3, 4, 5].map(skillWord)).toEqual(['Beginner', 'Basic', 'Intermediate', 'Advanced', 'Expert'])
    expect(certificationState({ status: 'EXPIRING', daysLeft: 16 }).label).toBe('Expires in 16 days')
    expect(certificationState({ status: 'EXPIRED' }).tone).toBe('danger')
  })
  it('days left and the full & final tab', () => {
    expect(daysLeft('2026-11-06', today)).toBe(35)
    expect(daysLeft('2026-10-01', today)).toBe(-1)
    expect(daysLeft(null, today)).toBeNull()
    expect(fnfState('PROCESSED')).toMatchObject({ label: 'Waiting for approval', tab: 'pending-approval' })
    expect(fnfState('APPROVED').tab).toBe('pending-payment')
    expect(fnfState('PAID').label).toBe('Settled')
    expect(fnfState(null)).toMatchObject({ label: 'Not started', tab: null })
  })
})
