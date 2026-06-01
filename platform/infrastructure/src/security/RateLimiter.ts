export interface RateLimitConfig {
  windowMs: number     // time window in milliseconds
  maxRequests: number  // max requests allowed in the window
  keyGenerator?: (identifier: string) => string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number    // Unix timestamp (ms) when the window resets
  retryAfter?: number // seconds to wait if blocked
}

export interface IRateLimiter {
  /**
   * Check if the identifier is within the rate limit.
   * Increments the counter if allowed.
   */
  check(identifier: string, config: RateLimitConfig): Promise<RateLimitResult>

  /**
   * Reset the counter for a specific identifier.
   */
  reset(identifier: string): Promise<void>
}

/**
 * Pre-built rate limit configurations for common use cases.
 */
export const RateLimits = {
  /** Login attempts: 5 per 15 minutes */
  login: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
  } as RateLimitConfig,

  /** General API calls: 100 per minute */
  api: {
    windowMs: 60 * 1000,
    maxRequests: 100,
  } as RateLimitConfig,

  /** File uploads: 20 per minute */
  fileUpload: {
    windowMs: 60 * 1000,
    maxRequests: 20,
  } as RateLimitConfig,

  /** Data exports: 5 per minute */
  export: {
    windowMs: 60 * 1000,
    maxRequests: 5,
  } as RateLimitConfig,

  /** Password reset: 3 per hour */
  passwordReset: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 3,
  } as RateLimitConfig,

  /** Email invitations: 10 per hour */
  invitation: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
  } as RateLimitConfig,

  /** Webhook triggers: 60 per minute */
  webhook: {
    windowMs: 60 * 1000,
    maxRequests: 60,
  } as RateLimitConfig,
} as const
