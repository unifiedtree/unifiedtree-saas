/**
 * Validate an email address
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/**
 * Validate a subdomain: lowercase alphanumeric + hyphens, 3-50 chars,
 * cannot start or end with a hyphen
 */
export function isValidSubdomain(subdomain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(subdomain)
}

export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate password strength with detailed error messages
 */
export function isValidPassword(password: string): PasswordValidationResult {
  const errors: string[] = []
  if (password.length < 8) errors.push('At least 8 characters required')
  if (!/[A-Z]/.test(password)) errors.push('Must contain an uppercase letter')
  if (!/[a-z]/.test(password)) errors.push('Must contain a lowercase letter')
  if (!/\d/.test(password)) errors.push('Must contain a number')
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password))
    errors.push('Must contain a special character')
  return { valid: errors.length === 0, errors }
}

/**
 * Validate a URL
 */
export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validate a phone number (basic international format)
 */
export function isValidPhone(phone: string): boolean {
  return /^\+?[\d\s\-().]{7,20}$/.test(phone.trim())
}

/**
 * Check if a string is a valid UUID v4
 */
export function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)
}

/**
 * Check if a value is "empty" (null, undefined, empty string, empty array/object)
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

/**
 * Validate a date string (ISO 8601 or YYYY-MM-DD)
 */
export function isValidDate(dateStr: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return !isNaN(d.getTime())
}

export type PasswordStrength = 'weak' | 'fair' | 'strong' | 'very-strong'

/**
 * Score password strength on a 4-level scale
 */
export function validatePasswordStrength(password: string): PasswordStrength {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[a-z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) score++
  if (password.length >= 16) score++

  if (score <= 2) return 'weak'
  if (score <= 4) return 'fair'
  if (score <= 6) return 'strong'
  return 'very-strong'
}

/**
 * Check if a string matches a given regex pattern
 */
export function matchesPattern(str: string, pattern: RegExp): boolean {
  return pattern.test(str)
}

/**
 * Validate that a number is within a range (inclusive)
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}
