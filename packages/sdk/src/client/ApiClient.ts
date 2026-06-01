import type { ApiError, PaginationParams, FilterParams } from '@erp/types'

export interface ApiClientConfig {
  baseUrl: string
  getToken: () => string | null
  onUnauthorized?: () => void
  onError?: (error: ApiError) => void
  timeout?: number
}

type QueryParams = PaginationParams & FilterParams & Record<string, string | number | boolean | undefined>

function buildQueryString(params: QueryParams): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)])
  if (entries.length === 0) return ''
  return '?' + new URLSearchParams(entries).toString()
}

export class ApiClient {
  private config: ApiClientConfig

  constructor(config: ApiClientConfig) {
    this.config = config
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.config.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const url = `${this.config.baseUrl}${path}`

    let res: Response
    try {
      res = await fetch(url, { ...options, headers })
    } catch {
      throw {
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'Network request failed. Check your connection.',
        timestamp: new Date().toISOString(),
      } satisfies ApiError
    }

    if (res.status === 401) {
      this.config.onUnauthorized?.()
      throw {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Session expired. Please log in again.',
        timestamp: new Date().toISOString(),
      } satisfies ApiError
    }

    if (!res.ok) {
      let error: ApiError
      try {
        error = await res.json()
      } catch {
        error = {
          status: res.status,
          code: 'UNKNOWN_ERROR',
          message: res.statusText || 'An unexpected error occurred',
          timestamp: new Date().toISOString(),
        }
      }
      this.config.onError?.(error)
      throw error
    }

    // Handle empty body (204 No Content)
    if (res.status === 204) return null as T

    return res.json() as Promise<T>
  }

  get<T>(path: string, params?: QueryParams): Promise<T> {
    const url = params ? `${path}${buildQueryString(params)}` : path
    return this.request<T>(url)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' })
  }
}

export function createApiClient(
  baseUrl: string,
  getToken: () => string | null,
  options?: Partial<Pick<ApiClientConfig, 'onUnauthorized' | 'onError' | 'timeout'>>
): ApiClient {
  return new ApiClient({ baseUrl, getToken, ...options })
}
