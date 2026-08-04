// Human labels for the field names the backend uses in validation errors.
// Extend as needed — an unmapped field falls through to its raw name.
const FIELD_LABELS: Record<string, string> = {
  adminName: 'Name',
  adminEmail: 'Email',
  adminMobile: 'Phone number',
  admin_name: 'Name',
  admin_email: 'Email',
  admin_mobile: 'Phone number',
  contact_email: 'Email',
  contact_phone: 'Phone number',
  companyName: 'Company name',
  display_name: 'Company name',
  subdomain: 'Workspace URL',
  password: 'Password',
  confirmPassword: 'Confirm password',
  seats: 'Number of users',
  country: 'Country',
  language: 'Language',
  primaryInterest: 'Primary interest',
  requestedModules: 'Selected modules',
}

// Common Jakarta Bean Validation phrases → human copy.
const PATTERN_MAP: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^size must be between (\d+) and (\d+)$/i,       (m) => `must be ${m[1]}–${m[2]} characters long`],
  [/^size must be less than or equal to (\d+)$/i,   (m) => `is too long (max ${m[1]} characters)`],
  [/^size must be greater than or equal to (\d+)$/i,(m) => `is too short (min ${m[1]} characters)`],
  [/^must not be (blank|null|empty)$/i,             () => 'is required'],
  [/^must be a well-formed email address$/i,        () => 'must be a valid email address'],
  [/^must match .*$/i,                              () => 'has an invalid format'],
  [/^must be greater than or equal to (\d+)$/i,     (m) => `must be at least ${m[1]}`],
  [/^must be less than or equal to (\d+)$/i,        (m) => `must be at most ${m[1]}`],
]

/**
 * Turn a backend validation message into something a user understands.
 *
 *   friendlyServerError('adminMobile: size must be between 0 and 20')
 *   → 'Phone number must be 0–20 characters long.'
 *
 * If the message doesn't look like a field-scoped validation error, it's
 * returned as-is with a period tacked on. Null / undefined / empty → a
 * generic "Something went wrong" fallback so the UI never renders blank.
 */
export function friendlyServerError(raw: string | undefined | null): string {
  if (!raw || !raw.trim()) return 'Something went wrong. Please try again.'

  // A response may bundle multiple validation errors: split by newline / comma / semicolon.
  const parts = raw.split(/\s*(?:\n|;)+\s*/).flatMap((s) => s.split(/,\s*(?=[a-zA-Z_][\w.]*:)/))
  const cleaned = parts.map((part) => translateOne(part.trim())).filter(Boolean)

  if (cleaned.length === 0) return raw
  if (cleaned.length === 1) return endWithPeriod(cleaned[0])
  return cleaned.map(endWithPeriod).join(' ')
}

function translateOne(raw: string): string {
  const fieldMatch = raw.match(/^([a-zA-Z_][\w.]*):\s*(.+)$/)
  const field = fieldMatch?.[1]
  const msg = (fieldMatch?.[2] ?? raw).trim()

  const humanMsg = PATTERN_MAP.reduce<string>((acc, [re, fn]) => {
    const hit = acc.match(re)
    return hit ? fn(hit) : acc
  }, msg)

  if (!field) return humanMsg
  const label = FIELD_LABELS[field] ?? field
  return `${label} ${humanMsg}`
}

function endWithPeriod(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`
}
