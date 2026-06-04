export const SEL = {
  // Header
  roleBadge: '[data-testid="role-badge"]',     // may need a data-testid in app code
  userMenu: '[data-testid="user-menu"]',
  logoutButton: 'role=menuitem[name="Sign out"]',

  // Sidebar nav items (by visible text — safer than testids for now)
  nav: {
    dashboard: 'role=link[name="Dashboard"]',
    employees: 'role=link[name="Directory"]',
    organization: 'role=link[name="Organization"]',
    attendance: 'role=link[name="Attendance"]',
    leave: 'role=link[name="Leave"]',
    onboarding: 'role=link[name="Onboarding"]',
    letters: 'role=link[name="Letters"]',
    reports: 'role=link[name="Reports"]',
    payroll: 'role=link[name=/Payroll/i]',
    users: 'role=link[name="Users & Access"]',
    roles: 'role=link[name="Roles & Perms"]',
    audit: 'role=link[name="Audit Logs"]',
    settings: 'role=link[name="Settings"]',
    myWorkspace: 'role=link[name="My Workspace"]',
    myAttendance: 'role=link[name="My Attendance"]',
    myLeave: 'role=link[name="My Leave"]',
    team: 'role=link[name="My Team"]',
  },

  // Common
  toast: '[role="status"]',          // most toast libs use this
  errorBoundary: 'text=/something went wrong/i',
  noAccessScreen: 'text=/access restricted|no access/i',
}
