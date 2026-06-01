import React, { createContext, useContext, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, createApiClient } from '../client/ApiClient'
import { tokenManager } from '../auth/tokenManager'
import type { ApiError } from '@erp/types'

interface ApiContextValue {
  client: ApiClient
}

const ApiContext = createContext<ApiContextValue | null>(null)

export interface ApiProviderProps {
  children: React.ReactNode
  baseUrl?: string
  queryClient?: QueryClient
  onUnauthorized?: () => void
  onError?: (error: ApiError) => void
}

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const apiError = error as unknown as ApiError
        // Don't retry on auth or client errors
        if (apiError?.status === 401 || apiError?.status === 403 || apiError?.status === 404) {
          return false
        }
        return failureCount < 2
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
})

export const ApiProvider: React.FC<ApiProviderProps> = ({
  children,
  baseUrl,
  queryClient = defaultQueryClient,
  onUnauthorized,
  onError,
}) => {
  const resolvedBaseUrl =
    baseUrl ??
    (typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>).__ERP_API_URL__ as string ?? ''
      : process.env['NEXT_PUBLIC_API_URL'] ?? '')

  const client = useMemo(
    () =>
      createApiClient(resolvedBaseUrl, () => tokenManager.getAccessToken(), {
        onUnauthorized,
        onError,
      }),
    [resolvedBaseUrl]
  )

  return (
    <ApiContext.Provider value={{ client }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  )
}

export function useApi(): ApiClient {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useApi must be used within ApiProvider')
  return ctx.client
}
