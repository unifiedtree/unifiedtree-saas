export type EmployeeSession = {
  accessToken: string
  refreshToken?: string
  userId: string
  employeeId?: string
  tenantId: string
  email: string
  roles: string[]
  permissions: string[]
}

const SESSION_KEY = 'employeeSession'

export function getEmployeeSession(): EmployeeSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as EmployeeSession
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }
}

export function setEmployeeSession(session: EmployeeSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearEmployeeSession() {
  sessionStorage.removeItem(SESSION_KEY)
}

export function employeeInitials(email: string) {
  const name = email.split('@')[0]?.trim()
  if (!name) return 'UT'
  return name
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'UT'
}
