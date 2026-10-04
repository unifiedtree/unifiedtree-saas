// Role codes as people read them ("HR_MANAGER" → "HR Manager"). Presentation
// only: nothing is decided by it. A code not listed (a custom role) still reads
// as words ("SITE_SUPERVISOR" → "Site supervisor"), never as the raw code.

/** Most senior first: the role a one-line title shows when someone holds several. */
export const ROLE_PRIORITY = ['SUPER_ADMIN', 'OWNER', 'COMPANY_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'MANAGER', 'EMPLOYEE'] as const

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Company Admin',
  OWNER: 'Company Owner', ADMIN: 'Company Admin', MANAGER: 'Manager',
  HR_MANAGER: 'HR Manager', FINANCE_LEAD: 'Finance Lead',
  DEPT_MANAGER: 'Dept Manager', EMPLOYEE: 'Employee',
}

export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code.replace(/_/g, ' ').trim().toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

/** The most senior built-in role held, or null. */
export function primaryRole(codes: readonly string[]): string | null {
  return (ROLE_PRIORITY as readonly string[]).find((r) => codes.includes(r)) ?? null
}

/** Every role held, most senior first, as one line: "Company Owner, Super Admin". Null when none. */
export function rolesLine(codes: readonly string[]): string | null {
  const rank = (c: string) => { const i = (ROLE_PRIORITY as readonly string[]).indexOf(c); return i < 0 ? ROLE_PRIORITY.length : i }
  const labels = [...new Set(codes.filter(Boolean))].sort((a, b) => rank(a) - rank(b)).map(roleLabel)
  return labels.length ? [...new Set(labels)].join(', ') : null
}
