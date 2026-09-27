// The "not available" state every shared hook uses (DECISIONS 18; AUDIT §3.1
// rule 6). Until an endpoint or its migration is live, the backend answers 404
// or 503 FEATURE_NOT_READY. A shared hook turns both into a typed state instead
// of an error: the page hides that block's actions and shows its empty or
// "not available yet" state. It never retries and never throws into the page.
// Any other failure (403, 422, 500, offline) stays an error, so the block shows
// its error state with Retry, exactly as other hooks do.
import {
  useMutation, useQuery,
  type QueryKey, type UseMutationResult, type UseQueryOptions, type UseQueryResult,
} from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { errorCodeOf, httpStatusOf, isFeatureNotReady } from '@/core/api/featureNotReady'

export type NotAvailableReason = 'FEATURE_NOT_READY' | 'NOT_FOUND'

/** What a shared call resolves to: the answer, or why the feature isn't there yet. */
export type Availability<T> =
  | { available: true; value: T }
  | { available: false; reason: NotAvailableReason }

/** How the shared hooks call the API: apiJson in the app, a stand-in in unit tests. */
export type ApiFetch = <T>(path: string, init?: RequestInit) => Promise<T>
export const defaultApi: ApiFetch = apiJson

/** FEATURE_NOT_READY or NOT_FOUND for the two "not there yet" answers; null for any other failure. */
export function notAvailableReason(error: unknown): NotAvailableReason | null {
  if (isFeatureNotReady(error)) return 'FEATURE_NOT_READY'
  if (httpStatusOf(error) === 404) return 'NOT_FOUND'
  return null
}

/**
 * For the few new paths that today match an existing `/{id}` mapping
 * (`/v1/hrms/employees/stats` and `/me` vs `/employees/{id}`,
 * `/v1/payroll/payslips/me/schedule` vs `/payslips/me/{runId}`,
 * `/v1/fnf/settlements/status` vs `/settlements/{id}`): until the owner adds
 * the literal path, Spring tries to read the word as a UUID and answers
 * 400 INVALID_PARAMETER instead of 404. These GETs take no path parameter of
 * their own, so that answer can only mean "not built yet".
 */
export function unmatchedPathParam(error: unknown): boolean {
  return httpStatusOf(error) === 400 && errorCodeOf(error) === 'INVALID_PARAMETER'
}

/** Runs a call and folds the "not there yet" answers into an Availability; other failures are rethrown. */
export async function asAvailable<T>(
  load: () => Promise<T>,
  alsoNotBuiltYet?: (error: unknown) => boolean,
): Promise<Availability<T>> {
  try {
    return { available: true, value: await load() }
  } catch (error) {
    const reason = notAvailableReason(error) ?? (alsoNotBuiltYet?.(error) ? 'NOT_FOUND' : null)
    if (reason) return { available: false, reason }
    throw error
  }
}

/**
 * A query result whose `data` is the answer itself (undefined while loading,
 * on error, and when not available), plus the typed "not available" state.
 * Everything else is React Query's own result (isLoading, error, refetch, …).
 * When `notAvailable` is true, `isSuccess` is true and `data` is undefined:
 * check `notAvailable` first.
 */
export type SharedQueryResult<T> = Omit<UseQueryResult<Availability<T>, Error>, 'data'> & {
  data: T | undefined
  notAvailable: boolean
  notAvailableReason: NotAvailableReason | null
}

/**
 * Maps a query result without reading every field: React Query re-renders a
 * component only for the fields it read, and a spread would read them all.
 * Don't spread the returned object either (it would lose the two added fields).
 */
export function withAvailability<T>(result: UseQueryResult<Availability<T>, Error>): SharedQueryResult<T> {
  return new Proxy(result, {
    get(target, key) {
      if (key === 'data') {
        const d = target.data
        return d && d.available ? d.value : undefined
      }
      if (key === 'notAvailable') return target.data?.available === false
      if (key === 'notAvailableReason') {
        const d = target.data
        return d && !d.available ? d.reason : null
      }
      return Reflect.get(target, key)
    },
  }) as unknown as SharedQueryResult<T>
}

/** A query as the shared hooks build it: its key and a queryFn that resolves to an Availability (callable in unit tests). */
export interface SharedQueryOptions<T> {
  queryKey: QueryKey
  queryFn: () => Promise<Availability<T>>
}

/** useQuery for a shared query, plus React Query's usual options (enabled, staleTime, refetchInterval, …). */
export function useAvailableQuery<T>(
  options: SharedQueryOptions<T> & Omit<UseQueryOptions<Availability<T>, Error, Availability<T>, QueryKey>, 'queryKey' | 'queryFn'>,
): SharedQueryResult<T> {
  return withAvailability(useQuery<Availability<T>, Error, Availability<T>, QueryKey>(options))
}

/**
 * A mutation result whose `data` (and what mutate/mutateAsync resolve to) is an
 * Availability: `{ available: false }` means the action isn't switched on yet,
 * so the page says so and hides it; it is not an error. Real refusals (422
 * with a plain-English message, 403, 500) still reject as errors.
 */
export type SharedMutationResult<R, V> = UseMutationResult<Availability<R>, Error, V> & {
  notAvailable: boolean
  notAvailableReason: NotAvailableReason | null
}

/** A mutation as the shared hooks build it (callable in unit tests without React). */
export interface SharedMutationOptions<R, V> {
  mutationFn: (vars: V) => Promise<Availability<R>>
  onSuccess?: (result: Availability<R>, vars: V) => Promise<unknown> | unknown
  onSettled?: (result: Availability<R> | undefined, error: Error | null, vars: V) => Promise<unknown> | unknown
}

export function useAvailableMutation<R, V>(options: SharedMutationOptions<R, V>): SharedMutationResult<R, V> {
  const m = useMutation<Availability<R>, Error, V>(options)
  const d = m.data
  return { ...m, notAvailable: d?.available === false, notAvailableReason: d && !d.available ? d.reason : null }
}

/** Days from `from` to `to` (yyyy-MM-dd), counting both ends; NaN when either isn't a date. */
export function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000) + 1
}
