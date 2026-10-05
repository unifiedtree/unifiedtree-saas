import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { answers, fakeApi } from '@/modules/hrms/api/shared/testing'
import { HttpError } from '@/core/api/client'
import type { EmployeeSearchHit } from '@/shared/search/useEmployeeSearch'
import {
  DELEGATE_CANDIDATES_PATH, DELEGATE_CANDIDATE_LIMIT, fallsBackToDirectory, resetDelegateSearch, searchDelegates,
} from './delegateSearch'
import { DelegateHits } from './DelegationCard'

const ASHA: EmployeeSearchHit = { id: 'e1', displayName: 'Asha Rao', employeeCode: 'EMP002', departmentName: 'Sales', jobTitle: 'Analyst', profilePhotoUrl: null }
const page = (employees: EmployeeSearchHit[]) => ({ employees, limit: 10, truncated: false })
const isCandidates = (p: string) => p.startsWith(DELEGATE_CANDIDATES_PATH)

afterEach(() => resetDelegateSearch())

describe('searchDelegates', () => {
  it('asks the delegation picker’s own endpoint first, with the trimmed text and its limit', async () => {
    const { api, calls } = fakeApi(() => page([ASHA]))
    const r = await searchDelegates('  as  ha ', api)
    expect(calls.map((c) => c.path)).toEqual([`${DELEGATE_CANDIDATES_PATH}?q=as%20ha&limit=${DELEGATE_CANDIDATE_LIMIT}`])
    expect(r.source).toBe('candidates')
    expect(r.employees).toEqual([ASHA])
  })

  it('falls back to the directory search where the endpoint isn’t deployed, and then stops asking for it', async () => {
    const { api, calls } = fakeApi((p) => { if (isCandidates(p)) throw answers.notFound(); return page([ASHA]) })
    const r = await searchDelegates('asha', api)
    expect(r.source).toBe('directory')
    expect(r.employees).toEqual([ASHA])
    expect(calls.map((c) => c.path)).toEqual([`${DELEGATE_CANDIDATES_PATH}?q=asha&limit=10`, '/v1/search?q=asha&limit=5'])
    await searchDelegates('ash', api)
    expect(calls.map((c) => c.path).slice(2)).toEqual(['/v1/search?q=ash&limit=5'])
  })

  it('also falls back on 405 (an older path mapping) and 503 not ready', async () => {
    const methodNotAllowed = new HttpError('Method not allowed', 405, { status: 405, errorCode: 'METHOD_NOT_ALLOWED' })
    for (const err of [methodNotAllowed, answers.notReady()]) {
      resetDelegateSearch()
      const { api } = fakeApi((p) => { if (isCandidates(p)) throw err; return page([]) })
      await expect(searchDelegates('as', api)).resolves.toMatchObject({ source: 'directory' })
    }
  })

  it('falls back on 403 (a workspace without HRMS) but asks again next time', async () => {
    const { api, calls } = fakeApi((p) => { if (isCandidates(p)) throw answers.forbidden(); return page([ASHA]) })
    await expect(searchDelegates('as', api)).resolves.toMatchObject({ source: 'directory' })
    await searchDelegates('ash', api)
    expect(calls.filter((c) => isCandidates(c.path))).toHaveLength(2)
  })

  it('shows a real failure as it is, without the directory search', async () => {
    const boom = answers.serverError()
    const { api, calls } = fakeApi(() => { throw boom })
    await expect(searchDelegates('as', api)).rejects.toBe(boom)
    expect(calls).toHaveLength(1)
  })

  it('passes on the directory search’s 403 for someone without hrms.employee.read on an old server', async () => {
    const { api } = fakeApi((p) => { if (isCandidates(p)) throw answers.notFound(); throw answers.forbidden() })
    await expect(searchDelegates('as', api)).rejects.toMatchObject({ status: 403 })
  })

  it('knows which answers mean "use the directory instead"', () => {
    expect(fallsBackToDirectory(answers.notFound())).toBe(true)
    expect(fallsBackToDirectory(answers.forbidden())).toBe(true)
    expect(fallsBackToDirectory(answers.notReady())).toBe(true)
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
