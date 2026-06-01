interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean>
}

class ApiClient {
  private baseUrl: string
  private token: string | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  setToken(token: string | null): void {
    this.token = token
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
    const url = new URL(this.baseUrl + path)
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
    }
    return url.toString()
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, ...init } = options
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    const response = await fetch(this.buildUrl(path, params), { ...init, headers })

    if (response.status === 401) {
      this.token = null
      window.dispatchEvent(new Event('auth:unauthorized'))
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { message?: string; errorCode?: string }
      throw new ApiError(response.status, errorData.message ?? 'Request failed', errorData.errorCode)
    }

    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params })
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) })
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' })
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const apiClient = new ApiClient(
  typeof window !== 'undefined'
    ? ((import.meta as Record<string, Record<string, string>>).env?.['VITE_API_URL'] ?? 'http://localhost:8080')
    : 'http://localhost:8080'
)

export default ApiClient
