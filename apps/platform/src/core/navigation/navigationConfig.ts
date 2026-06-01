export interface NavItemConfig {
  key: string
  label: string
  path?: string
  module?: string
  children?: { label: string; path: string }[]
}

export const MAIN_NAV: NavItemConfig[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'analytics', label: 'Analytics', path: '/analytics' },
]

export const MODULE_NAV: NavItemConfig[] = [
  {
    key: 'hrms', label: 'HRMS', module: 'hrms',
    children: [
      { label: 'Employees', path: '/hrms/employees' },
      { label: 'Attendance', path: '/hrms/attendance' },
      { label: 'Leave', path: '/hrms/leave' },
      { label: 'Payroll', path: '/hrms/payroll' },
    ],
  },
  {
    key: 'crm', label: 'CRM', module: 'crm',
    children: [
      { label: 'Leads', path: '/crm/leads' },
      { label: 'Customers', path: '/crm/customers' },
      { label: 'Deals', path: '/crm/deals' },
    ],
  },
  {
    key: 'accounts', label: 'Accounts', module: 'accounts',
    children: [
      { label: 'Invoices', path: '/accounts/invoices' },
      { label: 'Payments', path: '/accounts/payments' },
      { label: 'Expenses', path: '/accounts/expenses' },
    ],
  },
  { key: 'payroll', label: 'Payroll', path: '/payroll', module: 'payroll' },
  {
    key: 'projects', label: 'Projects', module: 'projects',
    children: [
      { label: 'All Projects', path: '/projects' },
      { label: 'Task Board', path: '/projects/board' },
    ],
  },
  { key: 'inventory', label: 'Inventory', path: '/inventory', module: 'inventory' },
  { key: 'procurement', label: 'Procurement', path: '/procurement', module: 'procurement' },
  {
    key: 'helpdesk', label: 'Helpdesk', module: 'helpdesk',
    children: [
      { label: 'Tickets', path: '/helpdesk/tickets' },
    ],
  },
]

export const PLATFORM_NAV: NavItemConfig[] = [
  { key: 'users', label: 'Users', path: '/users' },
  { key: 'roles', label: 'Roles', path: '/roles' },
  { key: 'audit', label: 'Audit Logs', path: '/audit-logs' },
  { key: 'files', label: 'Files', path: '/files' },
  { key: 'settings', label: 'Settings', path: '/settings' },
]
