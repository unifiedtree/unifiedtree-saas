export const TENANT_SUBDOMAIN = 'demo'
export const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

export const USERS = {
  superAdmin: {
    email: 'admin@unifiedtree.demo',
    password: 'Hrms@12345',
    role: 'SUPER_ADMIN',
    landingPath: '/dashboard',
    storageFile: 'super-admin.json',
  },
  hrManager: {
    email: 'hrm@unifiedtree.demo',
    password: 'Hrms@12345',
    role: 'HR_MANAGER',
    landingPath: '/dashboard',
    storageFile: 'hr-manager.json',
  },
  deptManager: {
    email: 'mgr@unifiedtree.demo',
    password: 'Hrms@12345',
    role: 'DEPT_MANAGER',
    landingPath: '/team',
    storageFile: 'dept-manager.json',
  },
  financeLead: {
    email: 'fin@unifiedtree.demo',
    password: 'Hrms@12345',
    role: 'FINANCE_LEAD',
    landingPath: '/hrms/reports',
    storageFile: 'finance-lead.json',
  },
  employee: {
    email: 'reader@unifiedtree.demo',
    password: 'Hrms@12345',
    role: 'EMPLOYEE',
    landingPath: '/me',
    storageFile: 'employee.json',
  },
} as const

export type UserKey = keyof typeof USERS

/** Maps a Playwright project name → USERS key (used to inject the role's token). */
export const PROJECT_TO_USER: Record<string, UserKey> = {
  'super-admin': 'superAdmin',
  'hr-manager': 'hrManager',
  'dept-manager': 'deptManager',
  'finance-lead': 'financeLead',
  'employee': 'employee',
}

/** sessionStorage key the SDK reads when VITE_DEV_TOKEN_STORAGE=session. */
export const SDK_SESSION_TOKEN_KEY = '__ut_access_token__'
