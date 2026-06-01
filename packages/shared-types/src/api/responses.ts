export interface ApiResponse<T> {
  data: T
  message?: string
  timestamp: string
}

export interface PaginatedResponse<T> {
  content: T[]
  totalElements: number
  totalPages: number
  currentPage: number
  pageSize: number
  hasNext: boolean
  hasPrevious: boolean
}

export interface ApiError {
  status: number
  code: string
  message: string
  details?: Record<string, string>
  timestamp: string
}

export interface PaginationParams {
  page?: number
  size?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface FilterParams {
  search?: string
  status?: string
  from?: string
  to?: string
  [key: string]: string | undefined
}

export type ApiResult<T> = ApiResponse<T>
export type PagedResult<T> = ApiResponse<PaginatedResponse<T>>

// Convenience type for mutations that return nothing
export type VoidResponse = ApiResponse<null>
