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
