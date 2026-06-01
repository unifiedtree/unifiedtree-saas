import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

export interface PlatformUser {
  id: string
  email: string
  mobileNumber?: string
  roles: string[]
  active: boolean
  employeeId?: string
}

export interface CreatePlatformUserRequest {
  email: string
  mobileNumber?: string
  rawPassword?: string
  roles: string[]
}

const PLATFORM_USERS_KEY = ['platform', 'users'] as const

export function usePlatformUsers() {
  return useQuery({
    queryKey: PLATFORM_USERS_KEY,
    queryFn: () => apiJson<PlatformUser[]>('/v1/platform/users'),
  })
}

export function useCreatePlatformUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreatePlatformUserRequest) =>
      apiJson<PlatformUser>('/v1/platform/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PLATFORM_USERS_KEY }),
  })
}
