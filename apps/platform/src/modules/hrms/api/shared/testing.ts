// Test helpers for the shared hooks. Imported only by the *.test.ts files next
// to them; nothing in the app imports this file, so it never reaches the bundle.
import { expect } from 'vitest'
import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { HttpError } from '@/core/api/client'
import type { ApiFetch } from './available'

export interface ApiCall {
  path: string
  method: string
  body: unknown
}

/** An ApiFetch that records each call and answers with `respond` (return a value, or throw an error). */
export function fakeApi(respond: (path: string, init?: RequestInit) => unknown = () => null) {
  const calls: ApiCall[] = []
  const api: ApiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body == null ? undefined : JSON.parse(String(init.body)) })
    return (await respond(path, init)) as T
  }
  return { api, calls }
}

const body = (status: number, errorCode: string, message: string) => ({ timestamp: '2026-09-27T04:30:00Z', status, errorCode, message })

/** The answers the backend gives, as apiJson throws them. */
export const answers = {
  notReady: () => new HttpError('This isn’t switched on yet.', 503, body(503, 'FEATURE_NOT_READY', 'This isn’t switched on yet.')),
  notFound: () => new HttpError('The requested resource was not found', 404, body(404, 'NOT_FOUND', 'The requested resource was not found')),
  /** What an unbuilt literal path answers when it falls into an existing `/{id}` mapping. */
  invalidParameter: () => new HttpError('Failed to convert value', 400, body(400, 'INVALID_PARAMETER', 'Failed to convert value')),
  forbidden: () => new HttpError('You do not have permission to perform this action', 403, body(403, 'ACCESS_DENIED', 'You do not have permission to perform this action')),
  refused: (errorCode: string, message: string) => new HttpError(message, 422, body(422, errorCode, message)),
  serverError: () => new HttpError('An unexpected error occurred', 500, body(500, 'INTERNAL_ERROR', 'An unexpected error occurred')),
}

/**
 * The rule every shared call follows: 404 and 503 FEATURE_NOT_READY resolve to
 * "not available"; 403, 422 and 500 still reject as errors.
 * `run` makes the call with the given api.
 */
export async function expectSharedMapping(run: (api: ApiFetch) => Promise<unknown>) {
  const throwing = (e: () => Error) => fakeApi(() => { throw e() }).api
  await expect(run(throwing(answers.notReady))).resolves.toEqual({ available: false, reason: 'FEATURE_NOT_READY' })
  await expect(run(throwing(answers.notFound))).resolves.toEqual({ available: false, reason: 'NOT_FOUND' })
  await expect(run(throwing(answers.forbidden))).rejects.toMatchObject({ status: 403 })
  await expect(run(throwing(() => answers.refused('SOME_RULE', 'Not allowed')))).rejects.toMatchObject({ status: 422, message: 'Not allowed' })
  await expect(run(throwing(answers.serverError))).rejects.toMatchObject({ status: 500 })
}

/** A QueryClient that records the keys it is asked to refresh instead of refetching. */
export function spyQueryClient() {
  const qc = new QueryClient()
  const invalidated: QueryKey[] = []
  qc.invalidateQueries = (async (filters?: { queryKey?: QueryKey }) => {
    if (filters?.queryKey) invalidated.push(filters.queryKey)
  }) as QueryClient['invalidateQueries']
  return { qc, invalidated }
}
