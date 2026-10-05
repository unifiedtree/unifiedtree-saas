import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { answers, fakeApi } from '@/modules/hrms/api/shared/testing'
import { HttpError } from '@/core/api/client'
import type { EmployeeSearchHit } from '@/shared/search/useEmployeeSearch'
import {
  DELEGATE_APPROVER_PERMISSIONS, DELEGATE_CANDIDATES_PATH, DELEGATE_CANDIDATE_LIMIT, delegateSearchVia, fallsBackToDirectory,
  resetDelegateSearch, searchDelegates,
} from './delegateSearch'
import { DelegateHits } from './DelegationCard'

const ASHA: EmployeeSearchHit = { id: 'e1', displayName: 'Asha Rao', employeeCode: 'EMP002', departmentName: 'Sales', jobTitle: 'Analyst', profilePhotoUrl: null }
const page = (employees: EmployeeSearchHit[]) => ({ employees, limit: 10, truncated: false })
const isCandidates = (p: string) => p.startsWith(DELEGATE_CANDIDATES_PATH)

afterEach(() => resetDelegateSearch())

describe('who searches what', () => {
  it('an approver uses the picker’s own search, with or without the directory permission', () => {
    expect(delegateSearchVia(true, false)).toBe('candidates')
    expect(delegateSearchVia(true, true)).toBe('candidates')
  })
  it('someone who approves nothing keeps the directory search if they had it, else gets no search box', () => {
    expect(delegateSearchVia(false, true)).toBe('directory')
    expect(delegateSearchVia(false, false)).toBeNull()
  })
  it('lists the server’s approval permissions (DelegationCandidatesController.APPROVER_PERMISSIONS)', () => {
    expect(DELEGATE_APPROVER_PERMISSIONS).toEqual([
      'hrms.leave.approve.l1', 'hrms.leave.approve.l2', 'hrms.leave.encash.approve', 'wfh.approve',
      'attendance.regularization.approve', 'attendance.overtime.approve', 'hrms.expense.claim.approve', 'hrms.advance.approve',
      'hrms.timesheet.approve', 'hrms.probation.team.decide', 'hrms.fnf.approve', 'hrms.learning.skill.approve',
    ])
    expect(DELEGATE_APPROVER_PERMISSIONS).not.toContain('hrms.employee.read')
  })
})

describe('searchDelegates', () => {
  it('an approver asks the picker’s own endpoint, with the trimmed text and its limit', async () => {
    const { api, calls } = fakeApi(() => page([ASHA]))
    const r = await searchDelegates('  as  ha ', 'candidates', api)
    expect(calls.map((c) => c.path)).toEqual([`${DELEGATE_CANDIDATES_PATH}?q=as%20ha&limit=${DELEGATE_CANDIDATE_LIMIT}`])
    expect(r.source).toBe('candidates')
    expect(r.employees).toEqual([ASHA])
  })

  it('the directory search is asked directly for someone who approves nothing', async () => {
    const { api, calls } = fakeApi(() => page([ASHA]))
    const r = await searchDelegates('asha', 'directory', api)
    expect(calls.map((c) => c.path)).toEqual(['/v1/search?q=asha&limit=5'])
    expect(r.source).toBe('directory')
  })

  it('falls back to the directory search where the endpoint isn’t deployed, and then stops asking for it', async () => {
    const { api, calls } = fakeApi((p) => { if (isCandidates(p)) throw answers.notFound(); return page([ASHA]) })
    const r = await searchDelegates('asha', 'candidates', api)
    expect(r.source).toBe('directory')
    expect(r.employees).toEqual([ASHA])
    expect(calls.map((c) => c.path)).toEqual([`${DELEGATE_CANDIDATES_PATH}?q=asha&limit=10`, '/v1/search?q=asha&limit=5'])
    await searchDelegates('ash', 'candidates', api)
    expect(calls.map((c) => c.path).slice(2)).toEqual(['/v1/search?q=ash&limit=5'])
  })

  it('also falls back on 405 (an older path mapping) and 503 not ready', async () => {
    const methodNotAllowed = new HttpError('Method not allowed', 405, { status: 405, errorCode: 'METHOD_NOT_ALLOWED' })
    for (const err of [methodNotAllowed, answers.notReady()]) {
      resetDelegateSearch()
      const { api } = fakeApi((p) => { if (isCandidates(p)) throw err; return page([]) })
      await expect(searchDelegates('as', 'candidates', api)).resolves.toMatchObject({ source: 'directory' })
    }
  })

  it('never falls back on 403: the refusal is shown, the directory isn’t asked', async () => {
    const { api, calls } = fakeApi((p) => { if (isCandidates(p)) throw answers.forbidden(); return page([ASHA]) })
    await expect(searchDelegates('as', 'candidates', api)).rejects.toMatchObject({ status: 403 })
    expect(calls.map((c) => c.path)).toEqual([`${DELEGATE_CANDIDATES_PATH}?q=as&limit=10`])
  })

  it('shows a real failure as it is, without the directory search', async () => {
    const boom = answers.serverError()
    const { api, calls } = fakeApi(() => { throw boom })
    await expect(searchDelegates('as', 'candidates', api)).rejects.toBe(boom)
    expect(calls).toHaveLength(1)
  })

  it('passes on the directory search’s 403 for an approver without hrms.employee.read on an old server', async () => {
    const { api } = fakeApi((p) => { if (isCandidates(p)) throw answers.notFound(); throw answers.forbidden() })
    await expect(searchDelegates('as', 'candidates', api)).rejects.toMatchObject({ status: 403 })
  })

  it('knows which answers mean "use the directory instead"', () => {
    expect(fallsBackToDirectory(answers.notFound())).toBe(true)
    expect(fallsBackToDirectory(answers.notReady())).toBe(true)
    expect(fallsBackToDirectory(answers.forbidden())).toBe(false)
    expect(fallsBackToDirectory(answers.serverError())).toBe(false)
    expect(fallsBackToDirectory(answers.invalidParameter())).toBe(false)
    expect(fallsBackToDirectory(new TypeError('Failed to fetch'))).toBe(false)
  })
})

const html = (props: Partial<Parameters<typeof DelegateHits>[0]>) =>
  renderToString(createElement(DelegateHits, { hits: [], fetching: false, error: null, onPick: () => {}, ...props }))
    .replace(/<!-- -->/g, '').replace(/&#x27;/g, "'")

describe('the delegate picker’s results', () => {
  it('lists each colleague with their code and designation', () => {
    const out = html({ hits: [ASHA], source: 'candidates' })
    expect(out).toContain('Asha Rao')
    expect(out).toContain('EMP002')
    expect(out).toContain('Analyst')
  })

  it('says who is listed when nothing matches the picker’s own search', () => {
    expect(html({ source: 'candidates' })).toContain('No matches. Only current colleagues who can sign in are listed.')
    // The directory search lists everyone current, so it doesn't say so.
    const old = html({ source: 'directory' })
    expect(old).toContain('No matches.')
    expect(old).not.toContain('who can sign in')
  })

  it('says plainly when the person may not look colleagues up, and when the search failed', () => {
    expect(html({ error: answers.forbidden() })).toContain("You don't have permission to look up colleagues.")
    const failed = html({ error: answers.serverError() })
    expect(failed).toContain("Couldn't search colleagues just now. Try again.")
    expect(failed).not.toContain('permission')
  })

  it('shows nothing misleading while the first answer is on its way', () => {
    const out = html({ fetching: true })
    expect(out).not.toContain('No matches')
  })
})
