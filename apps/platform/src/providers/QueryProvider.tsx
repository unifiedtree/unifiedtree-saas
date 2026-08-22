import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

function isRetryable(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false
  const status = (error as { response?: { status?: number } })?.response?.status
  if (status === 401 || status === 403 || status === 422) return false
  return true
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Deliberately still false. Flipping this globally re-fetches every
      // mounted query on every tab focus, and three screens seed local form
      // state from query data in an unguarded effect — a focus refetch that
      // returns a changed row swaps the object reference and silently wipes
      // what the user was typing:
      //   letters/LetterTemplateEditor.tsx:328  (resets the TipTap body)
      //   payroll/PayrollSettings.tsx:48        (resets the form AND clears `dirty`)
      //   probation/ProbationSettings.tsx:28    (same)
      // (organization/WorkTimeSettings.tsx:54 is the safe pattern — it bails
      // out while `dirty`.) Queries that genuinely need focus freshness opt in
      // per-hook with `refetchOnWindowFocus: 'always'`; see useSettings
      // useHolidays and useOrg useGrades / useEmploymentTypes.
      refetchOnWindowFocus: false,
      retry: isRetryable,
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
