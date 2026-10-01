// UnifiedTree HRMS redesign: nav model, shell behaviour, theme + font switching.
(() => {
  if (window.UTCore) return;
  const I = {
    dashboard: 'M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z',
    home: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    database: 'M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    userPlus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
    userCheck: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11l2 2 4-4',
    userX: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5M22 8l-5 5',
    target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    logOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    alarm: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2 2M5 3 2 6M22 6l-3-3',
    calendar: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18',
    calCheck: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M9 16l2 2 4-4',
    card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 10h20',
    receipt: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11',
    building: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18ZM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
    shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
    sliders: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
    chart: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
    trending: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
    dollar: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    rupee: 'M6 3h12M6 8h12M6 13l8.5 8M6 13h3M9 13c6.667 0 6.667-10 0-10',
    briefcase: 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
    package: 'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zM12 22V12M3.29 7 12 12l8.71-5',
    cart: 'M8 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
    settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    xCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6',
    minusCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12h8',
    checkCircle: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
    hourglass: 'M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2',
    timer: 'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
    file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8',
    percent: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    wallet: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
    bank: 'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z',
    mapPin: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    layers: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83zM2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17'
  };
  const pg = (k, l, t) => [k, l, t || null];
  const M = {
    dashboard: { label: 'Dashboard', icon: I.dashboard, pages: [pg('dashboard', 'Dashboard')] },
    me: { label: 'My Workspace', icon: I.home, pages: [pg('me', 'Overview'), pg('me-att', 'My attendance', ['Calendar', 'Time entries']), pg('me-leave', 'My leave', ['Balances', 'Requests']), pg('me-slips', 'Payslips'), pg('me-salary', 'Salary'), pg('me-wfh', 'Work from home'), pg('me-shift', 'Shift change'), pg('me-letters', 'Letters'), pg('me-assets', 'My assets')] },
    workforce: { label: 'Workforce', icon: I.database, pages: [pg('m-over', 'Master overview'), pg('m-dir', 'Workforce directory', ['Active', 'Probation', 'On notice', 'Exited', 'Suspended']), pg('m-org', 'Organization setup', ['Departments', 'Designations', 'Grades', 'Agencies']), pg('m-rules', 'Rules & policies', ['Policies', 'Shift rules', 'Leave rules', 'Manage policies'])] },
    hiring: { label: 'Hiring & onboarding', icon: I.userPlus, pages: [pg('h-pipe', 'Hiring', ['Pipeline', 'Requisitions', 'Interviews', 'Offers']), pg('h-onb', 'Onboarding & assets', ['New hires', 'Checklist templates', 'Assets']), pg('h-letters', 'Letters', ['Templates', 'Generated letters', 'Distributions', 'My letters']), pg('h-vault', 'Employee vault', ['Employee documents', 'My documents']), pg('h-docs', 'Docs to review')] },
    performance: { label: 'Performance', icon: I.target, pages: [pg('p-center', 'Performance', ['Review cycles', 'Employee reviews', 'Goals & KPIs', 'People', 'My reviews', 'My goals']), pg('p-learn', 'Learning', ['Programs', 'My training', 'Skill matrix', 'Certifications', 'Skill approvals'])] },
    exit: { label: 'Employee exit', icon: I.logOut, pages: [pg('x-res', 'Resignation & exit', ['On notice', 'Exited', 'Terminated']), pg('x-fnf', 'Full & final settlement', ['Pending approval', 'Pending payment', 'Settled', 'All'])] },
    attendance: { label: 'Attendance & time', icon: I.clock, pages: [pg('a-daily', 'Daily tracking', ['Today', 'Review', 'Manual entry']), pg('a-analytics', 'Attendance analytics', ['Overview', 'Punctuality', 'Overtime']), pg('a-shifts', 'Shifts & overtime', ['Shifts', 'Rosters', 'Overtime rules', 'Change requests'])] },
    leave: { label: 'Leave', icon: I.calendar, pages: [pg('l-ops', 'Leave operations', ['Approvals', 'Decided', 'Balances', 'Calendar', 'Encash', 'Year end', 'Leave types', 'Holidays'])] },
    payroll: { label: 'Payroll', icon: I.card, pages: [pg('py-dash', 'Payroll dashboard'), pg('py-runs', 'Processing & payslips', ['All runs', 'Overview', 'Employees', 'Skipped']), pg('py-struct', 'Salary structure'), pg('py-settings', 'Payroll settings'), pg('py-pli', 'Production-linked incentive', ['All awards', 'Monthly targets', 'My incentives']), pg('py-adv', 'Advances & loans', ['Company advances', 'My advances', 'Request an advance']), pg('py-bank', 'Bank disbursement', ['Current file', 'Past files', 'Bank profiles'])] },
    expenses: { label: 'Expenses', icon: I.receipt, pages: [pg('e-center', 'Expense center', ['Approvals', 'My claims', 'Submit a claim', 'Reimbursement batches', 'Policies'])] },
    company: { label: 'Company', icon: I.building, pages: [pg('c-cb', 'Companies & branches')] },
    compliance: { label: 'Compliance', icon: I.shield, pages: [pg('cp-stat', 'Statutory compliance', ['Compliance calendar', 'Statutory filings', 'POSH register', 'Inspector access']), pg('cp-muster', 'Muster roll')] },
    hrsetup: { label: 'HR setup', icon: I.sliders, pages: [pg('hs-config', 'HR configuration'), pg('hs-notif', 'Notification templates'), pg('hs-int', 'Integrations')] },
    reports: { label: 'Reports', icon: I.chart, pages: [pg('r-center', 'Reports center'), pg('r-wfa', 'Workforce analytics', ['Headcount', 'Attrition', 'Diversity'])] },
    crm: { label: 'CRM', icon: I.trending, soon: true, pages: [pg('crm-leads', 'Leads'), pg('crm-cust', 'Customers'), pg('crm-deals', 'Deals')] },
    accounts: { label: 'Accounts', icon: I.dollar, soon: true, pages: [pg('ac-inv', 'Invoices'), pg('ac-pay', 'Payments')] },
    projects: { label: 'Projects', icon: I.briefcase, soon: true, pages: [pg('pr-all', 'All projects'), pg('pr-board', 'Task board')] },
    inventory: { label: 'Inventory', icon: I.package, soon: true, pages: [pg('inv', 'Inventory')] },
    purchase: { label: 'Purchase', icon: I.cart, soon: true, pages: [pg('po', 'Procurement')] },
    ehome: { label: 'Home', icon: I.home, pages: [pg('e-home', 'Home')] },
    team: { label: 'My team', icon: I.users, pages: [pg('t-today', 'Team today'), pg('t-sched', 'Team schedule'), pg('t-appr', 'Approvals', ['All', 'Leave', 'Attendance', 'Requests', 'Expenses'])] },
    etime: { label: 'Time', icon: I.clock, pages: [pg('e-att', 'Attendance', ['This month', 'Timesheet']), pg('e-wfh', 'Work from home'), pg('e-shift', 'Shift change')] },
    eleave: { label: 'Leave', icon: I.calendar, pages: [pg('e-leave', 'Leave', ['Overview', 'Apply', 'Requests', 'Holidays'])] },
    epay: { label: 'Pay', icon: I.wallet, pages: [pg('e-slips', 'Payslips'), pg('e-salary', 'Salary'), pg('e-claims', 'Expense claims', ['My claims', 'New claim']), pg('e-adv', 'Advances')] },
    edocs: { label: 'Documents', icon: I.file, pages: [pg('e-letters', 'Letters'), pg('e-files', 'My documents'), pg('e-assets', 'My assets'), pg('e-pol', 'Policies')] },
    egrow: { label: 'Growth', icon: I.target, pages: [pg('e-rev', 'Reviews & goals'), pg('e-learn', 'Learning')] },
    settings: { label: 'Settings', icon: I.settings, pages: [pg('s-config', 'Settings', ['Profile', 'Branding', 'Security', 'Notifications', 'Billing & plan', 'Integrations', 'Document types', 'Danger zone']), pg('s-users', 'Users & access'), pg('s-roles', 'Roles & permissions', ['Roles', 'Who has which role', 'Permission catalogue']), pg('s-audit', 'Audit logs')] }
  };
  const GROUPS = [
    ['home', 'Home', ['dashboard', 'company']],
    ['people', 'People', ['workforce', 'hiring', 'performance', 'exit']],
    ['time', 'Time', ['attendance', 'leave']],
    ['pay', 'Pay & benefits', ['payroll', 'expenses']],
    ['org', 'Org & policy', ['compliance', 'hrsetup']],
    ['insights', 'Insights', ['reports']],
    ['apps', 'Business apps', ['crm', 'accounts', 'projects', 'inventory', 'purchase']]
  ];
  // Roles: the repo's OWNER/ADMIN/HR/FINANCE roles share the admin experience; DEPT_MANAGER and EMPLOYEE get their own.
  const ROLES = {
    admin: { label: 'HR admin', sub: 'Owners, admins, HR and finance', name: 'Demo Owner', title: 'HR admin · Owner', ini: 'DO', land: ['dashboard', 'dashboard'] },
    manager: { label: 'Manager', sub: 'Runs a team: approvals, schedule, reviews', name: 'Siddharth Rao', title: 'Engineering Manager', ini: 'SR', land: ['ehome', 'e-home'] },
    employee: { label: 'Employee', sub: 'Self-service for their own work and pay', name: 'Priya Sharma', title: 'Senior Engineer · Engineering', ini: 'PS', land: ['ehome', 'e-home'] }
  };
  const ROLE_OF = { 'HR admin': 'admin', Manager: 'manager', Employee: 'employee' };
  const SELF_CODE = { admin: 'SELF', manager: 'EMP-0185', employee: 'EMP-0101' };
  const MYWORK = ['etime', 'eleave', 'epay', 'edocs', 'egrow'];
  const RGROUPS = { admin: GROUPS, manager: [['home', 'Home', ['ehome']], ['team', 'My team', ['team']], ['mine', 'My work', MYWORK]], employee: [['home', 'Home', ['ehome']], ['mine', 'My work', MYWORK]] };
  const modsFor = r => [].concat(...(RGROUPS[r] || GROUPS).map(g => g[2])).concat(!r || r === 'admin' ? ['settings'] : []);
  const NOTIFS_R = {
    employee: [
      { id: 1, title: 'Siddharth Rao is reviewing your leave for 28–29 Sep', meta: 'Leave · 12 min ago', unread: true, d: I.calendar },
      { id: 2, title: 'HR asked for a clearer photo of your address proof', meta: 'Documents · 2 hr ago', unread: true, d: I.file },
      { id: 3, title: 'Your Q3 self-review is due Wed, 30 Sep', meta: 'Growth · Yesterday', unread: true, d: I.target },
      { id: 4, title: 'Your August payslip is ready', meta: 'Pay · 31 Aug', unread: false, d: I.receipt }
    ],
    manager: [
      { id: 1, title: '7 requests from your team are waiting for you', meta: 'Approvals · now', unread: true, d: I.inbox },
      { id: 2, title: 'Divya Pillai hasn’t checked in yet', meta: 'Team · 20 min ago', unread: true, d: I.clock },
      { id: 3, title: 'Aditya Rao’s probation ends Mon, 5 Oct', meta: 'Team · 1 hr ago', unread: true, d: I.hourglass },
      { id: 4, title: 'Kavya Menon sent her Q3 self-review', meta: 'Growth · Yesterday', unread: false, d: I.target }
    ]
  };
  const ACTS = { employee: [
    ['Apply leave', 'eleave', 'e-leave', 'Pick a type and dates. Siddharth is told right away.', I.calendar, 1],
    ['Work from home', 'etime', 'e-wfh', 'Ask to work from home on a day.', I.home, 0],
    ['Fix a missed punch', 'etime', 'e-att', 'Tell us when you really came in or left.', I.clock, 0],
    ['Download payslip', 'epay', 'e-slips', 'Your August payslip is ready.', I.receipt, 0],
    ['New expense claim', 'epay', 'e-claims', 'Add receipts and send them for approval.', I.wallet, 1],
    ['Sign a letter', 'edocs', 'e-letters', 'Your appraisal letter is waiting for your signature.', I.file, 0]
  ] };
  ACTS.manager = [['Review approvals', 'team', 't-appr', '7 requests from your team are waiting.', I.inbox, 0], ['Team schedule', 'team', 't-sched', 'Who works when next week.', I.calendar, 0]].concat(ACTS.employee);
  const JUMP = { employee: [['ehome', 'e-home'], ['eleave', 'e-leave'], ['epay', 'e-slips'], ['etime', 'e-att']], manager: [['team', 't-today'], ['team', 't-appr'], ['ehome', 'e-home'], ['eleave', 'e-leave']] };
  // page key -> designed view; tab index that is designed (undefined = every tab)
  const TIME = { 'a-analytics': 1, 'a-shifts': 1, 'cp-muster': 1, 'me-wfh': 1, 'me-shift': 1 };
  const SETUP = { 'cp-stat': 1, 'm-rules': 1, 'hs-config': 1, 'hs-notif': 1, 'hs-int': 1, 'r-wfa': 1 };
  const ADMIN = { 's-config': 1, 's-users': 1, 's-roles': 1, 's-audit': 1 };
  const TALENT = { 'h-pipe': 1, 'h-onb': 1, 'h-letters': 1, 'h-vault': 1, 'h-docs': 1, 'me-letters': 1, 'me-assets': 1 };
  const GROW = { 'p-center': 1, 'p-learn': 1, 'x-res': 1, 'me-att': 1, 'me-leave': 1 };
  const PAY = { 'py-dash': 1, 'py-struct': 1, 'py-settings': 1, 'py-pli': 1, 'py-adv': 1, 'py-bank': 1, 'e-center': 1, 'x-fnf': 1, 'me-slips': 1, 'me-salary': 1 };
  const VIEW = { 'm-over': 'over', 'm-org': 'org', dashboard: 'dash', 'a-daily': 'att', 'm-dir': 'dir', 'l-ops': 'leave', 'py-runs': 'pay', 'r-center': 'reports', me: 'me', 'c-cb': 'co',
    'e-home': 'ehome', 't-today': 'tteam', 't-sched': 'tteam', 't-appr': 'tappr', 'e-att': 'etime', 'e-wfh': 'etime', 'e-shift': 'etime', 'e-leave': 'eleave',
    'e-slips': 'epay', 'e-salary': 'epay', 'e-claims': 'epay', 'e-adv': 'epay', 'e-letters': 'edocs', 'e-files': 'edocs', 'e-assets': 'edocs', 'e-pol': 'edocs', 'e-rev': 'egrow', 'e-learn': 'egrow' };
  const VTAB = { dashboard: 0, 'a-daily': 0, 'l-ops': 0, 'py-runs': 1 };
  const LAND = {
    'Dashboard': ['dashboard', 'dashboard', 0], 'Attendance · Today': ['attendance', 'a-daily', 0], 'Workforce directory': ['workforce', 'm-dir', 0],
    'Employee profile': ['workforce', 'm-dir', 0, 'EMP-0101'], 'Leave requests': ['leave', 'l-ops', 0], 'Payroll run': ['payroll', 'py-runs', 1],
    'Reports': ['reports', 'r-center', 0], 'My Workspace': ['me', 'me', 0], 'Companies & branches': ['company', 'c-cb', 0]
  };

  // Dashboard day picker: working days this week (index 4 = today).
  const DASH_SECS = [['overview', 'Overview', 'dashboard'], ['attendance', 'Attendance', 'clock'], ['upcoming', 'Upcoming', 'calendar'], ['people', 'People', 'users'], ['hiring', 'Hiring & projects', 'briefcase'], ['payroll', 'Payroll & activity', 'rupee']];
  const DAYS = ['Mon, 21 Sep 2026', 'Tue, 22 Sep 2026', 'Wed, 23 Sep 2026', 'Thu, 24 Sep 2026', 'Fri, 25 Sep 2026'];
  const DARK = {
    '--u-bg': '#0A110E', '--u-sf': '#101915', '--u-sf2': '#0D1512', '--u-hv': '#16211C', '--u-ln': '#1F2C27', '--u-ln2': '#18231F',
    '--u-ink': '#E6EEEA', '--u-ink2': '#A7B6B0', '--u-ink3': '#80918A', '--u-brt': '#5CC4A3', '--u-brs': '#10271F', '--u-brs2': '#16362B', '--u-brl': '#22503F',
    '--u-gd': '#D9A441', '--u-gdt': '#E6B865', '--u-gds': '#2A2113', '--u-rd': '#E0645A', '--u-rdt': '#F18B80', '--u-rds': '#2C1715',
    '--u-g2': '#3F9C84', '--u-g3': '#2B5C4E', '--u-gy': '#3A4843', '--u-ov': 'rgba(0,0,0,.55)',
    '--u-shc': '0 1px 2px rgba(0,0,0,.5)', '--u-shh': '0 22px 44px -22px rgba(0,0,0,.85), 0 0 0 1px rgba(92,196,163,.22)', '--u-shp': '0 24px 60px -20px rgba(0,0,0,.8)'
  };
  const GF = 'https://fonts.googleapis.com/css2?display=swap&family=';
  const FONTS = {
    'Plus Jakarta Sans': { css: GF + 'Plus+Jakarta+Sans:wght@300;400;500;600;700', stack: "'Plus Jakarta Sans', system-ui, sans-serif" },
    'Geist': { css: GF + 'Geist:wght@400;500;600;700', stack: "'Geist', system-ui, sans-serif" },
    'Manrope': { css: GF + 'Manrope:wght@400;500;600;700', stack: "'Manrope', system-ui, sans-serif" },
    'Onest': { css: GF + 'Onest:wght@400;500;600;700', stack: "'Onest', system-ui, sans-serif" },
    'Instrument Sans': { css: GF + 'Instrument+Sans:wght@400;500;600;700', stack: "'Instrument Sans', system-ui, sans-serif" },
    'DM Sans': { css: GF + 'DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700', stack: "'DM Sans', system-ui, sans-serif" },
    'Figtree': { css: GF + 'Figtree:wght@400;500;600;700', stack: "'Figtree', system-ui, sans-serif" },
    'Satoshi': { css: 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap', stack: "'Satoshi', system-ui, sans-serif" }
  };
  const loaded = { Geist: 1 };
  function applyTheme(t) {
    const st = document.documentElement.style;
    Object.keys(DARK).forEach(k => (t === 'dark' ? st.setProperty(k, DARK[k]) : st.removeProperty(k)));
    st.colorScheme = t === 'dark' ? 'dark' : 'light';
    if (document.body) document.body.style.background = t === 'dark' ? DARK['--u-bg'] : '';
  }
  function applyFont(name) {
    const f = FONTS[name] || FONTS['Plus Jakarta Sans'];
    if (!loaded[name] && FONTS[name]) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = f.css; document.head.appendChild(l); loaded[name] = 1; }
    document.documentElement.style.setProperty('--u-font', f.stack);
  }
  function applyFx(level) { document.documentElement.setAttribute('data-ufx', level || 'full'); }

  const NOTIFS = [
    { id: 1, title: 'Priya Sharma applied for 2 days of casual leave', meta: 'Leave · 12 min ago', unread: true, d: I.calendar },
    { id: 2, title: 'September payroll is ready for your review', meta: 'Payroll · 1 hr ago', unread: true, d: I.card },
    { id: 3, title: '4 regularisation requests are waiting', meta: 'Attendance · 2 hr ago', unread: true, d: I.clock },
    { id: 4, title: 'Rahul Kumar finished onboarding', meta: 'Hiring · Yesterday', unread: false, d: I.userCheck }
  ];

  function fit(avail, cfg, groups) {
    const vis = [], over = [], all = !(avail > 0);
    let used = 0, cut = false;
    (groups || GROUPS).forEach(([key, label, items], gi) => {
      const v = { key, label, items: [] }, o = { key, label, items: [] };
      items.forEach(k => {
        if (all) { v.items.push(k); return; }
        if (!cut) {
          const add = (v.items.length === 0 ? (gi > 0 ? cfg.groupH : 0) : cfg.gap) + cfg.itemH;
          if (used + add <= avail) { used += add; v.items.push(k); return; }
          cut = true;
        }
        o.items.push(k);
      });
      if (v.items.length) vis.push(v);
      if (o.items.length) over.push(o);
    });
    return { vis, over };
  }
  function observe(cmp, el) {
    if (cmp._ro) { cmp._ro.disconnect(); cmp._ro = null; }
    if (!el || typeof ResizeObserver === 'undefined') return;
    cmp._ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el);
      const h = Math.floor(el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0));
      if (Math.abs(h - (cmp.state.listH || 0)) >= 1) cmp.setState({ listH: h });
    });
    cmp._ro.observe(el);
  }
  function init(p) {
    const start = (p && p.start) || 'Icon rail';
    const role = ROLE_OF[p && p.role] || 'admin';
    const land = role === 'admin' ? (LAND[p && p.page] || LAND.Dashboard) : ROLES[role].land;
    return { role, roleMenu: false, boot: false, pinned: start === 'Pinned open', pagePanel: start === 'Pages panel open', more: false, search: false, bell: false, menu: false,
      mod: land[0], page: land[1], tab: land[2] || 0, profile: land[3] || null, q: '', listH: 0, last: {}, toast: null, theme: null, dashDay: 4, dayMenu: false, dashSec: 'overview', dashJump: 0,
      notifs: (NOTIFS_R[role] || NOTIFS).map(n => Object.assign({}, n)) };
  }
  function roleState(r) {
    const L = ROLES[r].land;
    return { role: r, roleMenu: false, mod: L[0], page: L[1], tab: 0, profile: null, selfProfile: false, q: '', last: {}, pagePanel: false, more: false, bell: false, menu: false, search: false, dayMenu: false, notifs: (NOTIFS_R[r] || NOTIFS).map(n => Object.assign({}, n)) };
  }
  function mount(cmp) {
    cmp._key = e => {
      const s = cmp.state;
      if (e.key === 'Escape') { if (s.search) cmp.setState({ search: false }); else if (s.more || s.bell || s.menu || s.dayMenu) cmp.setState({ more: false, bell: false, menu: false, dayMenu: false }); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); cmp.setState({ search: true, more: false, bell: false, menu: false }); }
    };
    document.addEventListener('keydown', cmp._key);
    cmp._hash = () => {
      const h = decodeURIComponent(location.hash.slice(1)).split('/').filter(Boolean), cur = cmp.state.role || 'admin';
      const role = ROLES[h[0]] ? h.shift() : cur, m = M[h[0]], ok = m && modsFor(role).indexOf(h[0]) >= 0;
      if (!ok && role === cur) return;
      const st = role !== cur ? roleState(role) : {};
      if (ok) Object.assign(st, { mod: h[0], page: m.pages.some(x => x[0] === h[1]) ? h[1] : m.pages[0][0], tab: +h[2] || 0, profile: h[3] || null });
      cmp.setState(Object.assign(st, { q: '', pagePanel: false, more: false, search: false, bell: false, menu: false, dayMenu: false, dashSec: 'overview' }));
      const sc = document.querySelector('[data-ut-scroll]'); if (sc) sc.scrollTop = 0;
    };
    window.addEventListener('hashchange', cmp._hash);
    cmp._hash();
  }
  function unmount(cmp) {
    if (cmp._key) document.removeEventListener('keydown', cmp._key);
    if (cmp._hash) window.removeEventListener('hashchange', cmp._hash);
    clearTimeout(cmp._tt);
    if (cmp._ro) cmp._ro.disconnect();
  }
  function vals(cmp, cfg, theme) {
    const s = cmp.state, set = o => cmp.setState(o);
    const role = s.role || 'admin', R = ROLES[role], allowed = modsFor(role);
    const mk0 = M[s.mod] && allowed.indexOf(s.mod) >= 0 ? s.mod : R.land[0], mod = M[mk0], pages = mod.pages, multi = pages.length > 1;
    const pi = Math.max(0, pages.findIndex(x => x[0] === s.page)), cur = pages[pi], tabs = cur[2] || [];
    const tab = Math.min(s.tab || 0, Math.max(0, tabs.length - 1));
    const panelShown = !!s.pagePanel && multi, push = !!s.pinned && !panelShown;
    const f = fit(s.listH, cfg, RGROUPS[role]), overKeys = [].concat(...f.over.map(g => g.items));
    const toast = msg => { cmp.setState({ toast: msg }); clearTimeout(cmp._tt); cmp._tt = setTimeout(() => cmp.setState({ toast: null }), 2600); };
    const go = (mk, pk, tb, rail) => {
      const m = M[mk]; if (!m) return;
      const st = cmp.state, page = pk || (st.last && st.last[mk]) || (mk === 'workforce' ? 'm-dir' : m.pages[0][0]);
      cmp.setState({ mod: mk, page, tab: tb || 0, q: '', profile: null, pagePanel: rail && m.pages.length > 1 ? true : st.pagePanel, more: false, search: false, bell: false, menu: false, dayMenu: false, dashSec: 'overview', last: Object.assign({}, st.last, { [mk]: page }) });
      const sc = document.querySelector('[data-ut-scroll]'); if (sc) sc.scrollTop = 0;
    };
    const item = k => ({ key: k, label: M[k].label, d: M[k].icon, hasPages: M[k].pages.length > 1, soon: !!M[k].soon, on: k === mk0, off: k !== mk0, go: () => go(k, null, 0, true) });
    if (!cmp._lr) cmp._lr = el => observe(cmp, el);
    const notifs = s.notifs || [], unread = notifs.filter(n => n.unread).length;
    const moreOn = !!s.more || overKeys.indexOf(mk0) >= 0 || mk0 === 'settings';
    const view = s.profile ? 'prof' : TIME[cur[0]] || ((cur[0] === 'a-daily' || cur[0] === 'l-ops') && tab > 0) ? 'time' : PAY[cur[0]] || (cur[0] === 'py-runs' && tab !== 1) ? 'paypg' : SETUP[cur[0]] ? 'setup' : TALENT[cur[0]] ? 'talent' : GROW[cur[0]] ? 'grow' : ADMIN[cur[0]] ? 'admin' : (VIEW[cur[0]] && (VTAB[cur[0]] == null || VTAB[cur[0]] === tab) ? VIEW[cur[0]] : 'gen');
    const dark = theme === 'dark', dd = s.dashDay == null ? 4 : s.dashDay;
    const setRole = r => { if (!ROLES[r] || r === role) { set({ roleMenu: false }); return; } cmp.setState(roleState(r)); const sc = document.querySelector('[data-ut-scroll]'); if (sc) sc.scrollTop = 0; if (location.hash) history.replaceState(null, '', location.pathname + location.search); };
    return {
      role, isAdmin: role === 'admin', notAdmin: role !== 'admin', isManager: role === 'manager', roleLabel: R.label, userName: R.name, userTitle: R.title, userIni: R.ini,
      roleMenu: !!s.roleMenu, toggleRole: () => set({ roleMenu: !s.roleMenu, bell: false, menu: false, more: false }), closeRole: () => set({ roleMenu: false }),
      roles: Object.keys(ROLES).map(k => ({ key: k, label: ROLES[k].label, sub: ROLES[k].sub, who: ROLES[k].name + ' · ' + ROLES[k].title, ini: ROLES[k].ini, on: k === role, off: k !== role, go: () => setRole(k) })),
      dashSec: s.dashSec || 'overview', dashJump: s.dashJump || 0, setSec: k => { if (cmp.state.dashSec !== k) set({ dashSec: k }); },
      dashPills: DASH_SECS.map(([key, label, ic]) => ({ key, label, d: I[ic] || I.dashboard, on: (s.dashSec || 'overview') === key, off: (s.dashSec || 'overview') !== key, go: () => set({ dashSec: key, dashJump: (cmp.state.dashJump || 0) + 1 }) })),
      isDash: view === 'dash', dashDay: dd, setDay: i => set({ dashDay: i }), notToday: dd !== 4, backToday: () => set({ dashDay: 4, dayMenu: false }),
      dayLabel: (dd === 4 ? 'Today · ' : '') + DAYS[dd], dayMenu: !!s.dayMenu, dayMenuStr: s.dayMenu ? 'true' : 'false',
      toggleDay: () => set({ dayMenu: !s.dayMenu, bell: false, more: false, menu: false }), closeDay: () => set({ dayMenu: false }),
      days: DAYS.map((d, i) => ({ label: d, isToday: i === 4, on: i === dd, off: i !== dd, go: () => set({ dashDay: i, dayMenu: false }) })),
      pushOn: push, pushOff: !push, panelOn: panelShown, pinned: !!s.pinned, notPinned: !s.pinned,
      pinLabel: s.pinned ? 'Collapse sidebar' : 'Keep sidebar open',
      togglePin: () => set(s.pinned ? { pinned: false } : { pinned: true, pagePanel: false }),
      listRef: cmp._lr,
      groups: f.vis.map((g, gi) => ({ key: g.key, label: g.label, sep: gi > 0, items: g.items.map(item) })),
      more: !!s.more, moreOn, moreOff: !moreOn,
      toggleMore: () => set({ more: !s.more, search: false, bell: false, menu: false }), closeMore: () => set({ more: false }),
      hasMoreBadge: overKeys.length > 0, moreBadge: '+' + overKeys.length,
      overflowGroups: f.over.map(g => ({ key: g.key, label: g.label, modules: g.items.map(k => ({ key: k, label: M[k].label, d: M[k].icon, soon: !!M[k].soon, go: () => go(k, null, 0, true), pages: M[k].pages.map(x => ({ label: x[1], go: () => go(k, x[0], 0, true) })) })) })),
      notifs: notifs.map(n => Object.assign({}, n, { dotOn: !!n.unread, dotOff: !n.unread, open: () => { set({ bell: false, notifs: cmp.state.notifs.map(x => x.id === n.id ? Object.assign({}, x, { unread: false }) : x) }); toast(n.title); } })),
      unread, hasUnread: unread > 0, unreadLabel: unread ? unread + ' new' : 'All caught up',
      markRead: () => set({ notifs: notifs.map(n => Object.assign({}, n, { unread: false })) }),
      bellFromMore: () => set({ more: false, bell: true, menu: false }),
      bell: !!s.bell, toggleBell: () => set({ bell: !s.bell, menu: false, more: false }),
      menu: !!s.menu, toggleMenu: () => set({ menu: !s.menu, bell: false, more: false }), closePops: () => set({ bell: false, menu: false }),
      isDark: dark, isLight: !dark, themeLabel: dark ? 'Switch to light' : 'Switch to dark', toggleTheme: () => set({ theme: dark ? 'light' : 'dark' }),
      openSettings: role === 'admin' ? () => go('settings', null, 0, true) : () => { set({ more: false }); toast('Opens your account settings: photo, sign-in and alerts'); },
      openMe: role === 'admin' ? () => go('dashboard', 'dashboard') : () => go('ehome', 'e-home'),
      openMyProfile: () => { set({ profile: SELF_CODE[role], selfProfile: true, q: '', bell: false, menu: false, more: false, search: false, roleMenu: false }); const sc = document.querySelector('[data-ut-scroll]'); if (sc) sc.scrollTop = 0; },
      selfProfile: !!s.selfProfile && !!s.profile, curMod: mk0,
      toggleThemeKeep: null, signOut: () => { set({ menu: false, more: false }); toast('Signs you out'); }, help: () => { set({ menu: false, more: false }); toast('Opens Help & support'); },
      panelW: panelShown ? cfg.P : 0, modIcon: mod.icon, modLabel: mod.label, pageCount: pages.length + ' pages',
      pages: pages.map((x, i) => ({ label: x[1], count: x[2] ? x[2].length : 0, hasCount: !!x[2], on: i === pi, off: i !== pi, go: () => set({ page: x[0], tab: 0, q: '', profile: null, last: Object.assign({}, s.last, { [mk0]: x[0] }) }) })),
      closePanel: () => set({ pagePanel: false }), openPanel: () => set({ pagePanel: true }), showPanelBtn: multi && !panelShown,
      hasTabs: tabs.length > 0 && !s.profile, noTabs: (tabs.length === 0 || !!s.profile) && view !== 'dash',
      tabs: tabs.map((t, i) => ({ label: t, on: i === tab, off: i !== tab, go: () => set({ tab: i, profile: null }) })),
      pageKey: cur[0], pageLabel: s.profile ? (s.selfProfile ? 'My profile' : 'Employee profile') : cur[1], tabLabel: tabs[tab] || '', tab,
      q: s.q || '', setQ: e => set({ q: e.target.value }), hasQ: !!s.q, qLabel: '“' + (s.q || '') + '”', clearQ: () => set({ q: '' }), setFilter: v => set({ q: v, search: false }), searchPh: 'Search ' + (s.profile ? 'this profile' : cur[1].toLowerCase()) + '…',
      search: !!s.search, openSearch: () => set({ search: true, more: false, bell: false, menu: false }), closeSearch: () => set({ search: false }),
      goTo: (mk, pk, tb) => go(mk, pk, tb), setTab: i => set({ tab: i }),
      openProfile: code => { set({ mod: 'workforce', page: 'm-dir', profile: code || 'EMP-0101', selfProfile: false, q: '', bell: false, menu: false, search: false }); const sc = document.querySelector('[data-ut-scroll]'); if (sc) sc.scrollTop = 0; },
      closeProfile: () => set({ profile: null, selfProfile: false }), profileCode: s.profile || '',
      vDash: view === 'dash', vAtt: view === 'att', vDir: view === 'dir', vProf: view === 'prof', vLeave: view === 'leave', vPay: view === 'pay', vRep: view === 'reports', vMe: view === 'me', vCo: view === 'co', vOver: view === 'over', vTime: view === 'time', vOrg: view === 'org', vGen: view === 'gen', vPayPg: view === 'paypg', vSetup: view === 'setup', vAdmin: view === 'admin', vTalent: view === 'talent', vGrow: view === 'grow',
      vEHome: view === 'ehome', vETime: view === 'etime', vELeave: view === 'eleave', vEPay: view === 'epay', vEDocs: view === 'edocs', vEGrow: view === 'egrow', vTTeam: view === 'tteam', vTAppr: view === 'tappr',
      viewKey: view + ':' + cur[0] + ':' + tab + ':' + (s.profile || ''),
      toast, toastOn: !!s.toast, toastMsg: s.toast || ''
    };
  }
  window.UTCore = { ROLES, RGROUPS, ACTS, JUMP, modsFor, I, M, GROUPS, LAND, FONTS, DARK, NOTIFS, applyTheme, applyFont, applyFx, init, mount, unmount, vals };
})();
