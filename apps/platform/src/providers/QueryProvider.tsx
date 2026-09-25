import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Which failures are worth another attempt.
 *
 * This read `error.response.status` — the axios shape. Everything on this side
 * throws `HttpError` from apiJson, which carries a flat `.status`, or a bare
 * TypeError when the browser blocks the response, so the status was ALWAYS
 * undefined: every failure was retried three times. A 403 on a section the
 * signed-in role cannot see cost four requests instead of one, and one blocked
 * minute turned a single dashboard load into ~60 requests, which kept the
 * edge's per-IP rate limit tripped and the whole network locked out.
 *
 * `failureCount` is the number of attempts that have already failed, so
 * `< 2` allows exactly one retry.
 */
export function isRetryable(failureCount: number, error: unknown): boolean {
  const e = error as { status?: number; response?: { status?: number } } | null
  const status = e?.status ?? e?.response?.status
  if (typeof status === 'number') {
    // A client error is an answer, not a blip: not signed in (401), not allowed
    // (403), not found (404), invalid (422), slow down (429). Asking again
    // cannot change any of them. Only a timeout is worth repeating.
    if (status < 500) return status === 408 && failureCount < 2
    return failureCount < 2
  }
  // No status: the request never completed — a dropped connection, a timeout,
  // or a response the browser refused to hand over. One more try, then stop.
  return failureCount < 2
}

/** Back off, and spread retries out so 15 queries failing together don't all fire at once. */
function retryDelay(attemptIndex: number): number {
  return Math.min(8_000, 500 * 2 ** attemptIndex) + Math.floor(Math.random() * 250)
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Deliberately still false. Flipping this globally re-fetches every
      // mounted query on every tab focus, and two screens seed local form
      // state from query data in an unguarded effect — a focus refetch that
      // returns a changed row swaps the object reference and silently wipes
      // what the user was typing:
      //   letters/LetterTemplateEditor.tsx:328  (resets the TipTap body)
      //   payroll/PayrollSettings.tsx:48        (resets the form AND clears `dirty`)
      // (settings/HrConfigurationPage.tsx is the safe pattern — edits live in
      // their own state and only replace the saved values once changed.) Queries that genuinely need focus freshness opt in
      // per-hook with `refetchOnWindowFocus: 'always'`; see useSettings
      // useHolidays and useOrg useGrades / useEmploymentTypes.
      refetchOnWindowFocus: false,
      retry: isRetryable,
      retryDelay,
    },
    mutations: {
      retry: false,
    },
  },
})

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
