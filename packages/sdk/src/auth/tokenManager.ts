import type { AuthTokens } from '@erp/types'

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'erp_access_token',
  REFRESH_TOKEN: 'erp_refresh_token',
  EXPIRES_AT: 'erp_token_expires_at',
} as const

const REFRESH_BUFFER_MS = 60_000 // refresh 1 min before expiry

function safeStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // SSR or storage blocked
  }
}

function safeRemoveStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export class TokenManager {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private refreshCallback: ((refreshToken: string) => Promise<AuthTokens>) | null = null

  getAccessToken(): string | null {
    return safeStorage(STORAGE_KEYS.ACCESS_TOKEN)
  }

  getRefreshToken(): string | null {
    return safeStorage(STORAGE_KEYS.REFRESH_TOKEN)
  }

  getExpiresAt(): Date | null {
    const val = safeStorage(STORAGE_KEYS.EXPIRES_AT)
    if (!val) return null
    return new Date(val)
  }

  setTokens(tokens: AuthTokens): void {
    safeSetStorage(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken)
    safeSetStorage(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken)
    safeSetStorage(STORAGE_KEYS.EXPIRES_AT, tokens.expiresAt)
    this.scheduleRefresh(new Date(tokens.expiresAt))
  }

  clearTokens(): void {
    safeRemoveStorage(STORAGE_KEYS.ACCESS_TOKEN)
    safeRemoveStorage(STORAGE_KEYS.REFRESH_TOKEN)
    safeRemoveStorage(STORAGE_KEYS.EXPIRES_AT)
    this.cancelRefresh()
  }

  isExpired(): boolean {
    const expiresAt = this.getExpiresAt()
    if (!expiresAt) return true
    return Date.now() >= expiresAt.getTime()
  }

  isExpiringSoon(): boolean {
    const expiresAt = this.getExpiresAt()
    if (!expiresAt) return true
    return Date.now() >= expiresAt.getTime() - REFRESH_BUFFER_MS
  }

  onRefresh(callback: (refreshToken: string) => Promise<AuthTokens>): void {
    this.refreshCallback = callback
  }

  private scheduleRefresh(expiresAt: Date): void {
    this.cancelRefresh()
    const delay = expiresAt.getTime() - Date.now() - REFRESH_BUFFER_MS
    if (delay <= 0) return

    this.refreshTimer = setTimeout(async () => {
      const refreshToken = this.getRefreshToken()
      if (!refreshToken || !this.refreshCallback) return
      try {
        const tokens = await this.refreshCallback(refreshToken)
        this.setTokens(tokens)
      } catch {
        this.clearTokens()
      }
    }, delay)
  }

  private cancelRefresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }
}

// Singleton instance for the app
export const tokenManager = new TokenManager()
