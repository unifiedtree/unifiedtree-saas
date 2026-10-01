// Demo data + formatting helpers for the HRMS redesign pages. Replace with API calls in the app.
(() => {
  if (window.UTD) return;
  const TONE = {
    ok: ['var(--u-brs,#E8F3EE)', 'var(--u-brt,#0F6E56)'], warn: ['var(--u-gds,#FAF1E1)', 'var(--u-gdt,#8A5A10)'],
    bad: ['var(--u-rds,#FCEDEB)', 'var(--u-rdt,#B42318)'], mint: ['var(--u-brs2,#D2EADF)', 'var(--u-brt,#0F6E56)'],
    info: ['var(--u-hv,#F0F4F2)', 'var(--u-ink2,#4A5A54)'], gray: ['var(--u-hv,#F0F4F2)', 'var(--u-ink3,#6A7A73)']
  };
  const pill = t => { const k = TONE[t] ? t : 'info'; return { pbg: TONE[k][0], pfg: TONE[k][1], pOk: k === 'ok', pWarn: k === 'warn', pBad: k === 'bad', pMint: k === 'mint', pInfo: k === 'info', pGray: k === 'gray' }; };
  const ini = n => String(n || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const money = n => '₹' + Math.round(Number(n)).toLocaleString('en-IN');
  const lakh = n => '₹' + (n / 100000).toFixed(1) + 'L';
  const ATT = {
    present: ['Present', 'ok'], late: ['Late', 'warn'], wfh: ['Work from home', 'mint'], leave: ['On leave', 'info'], absent: ['Absent', 'bad'], none: ['Not marked', 'gray']
  };
  const P = (code, name, dept, role, branch, mgr, joined, type, status, shift, st, inT, outT, hrs, pct, src, late) =>
    ({ code, name, email: name.toLowerCase().split(' ').join('.') + '@demotech.in', dept, role, branch, mgr, joined, type, status, shift, st, inT, outT, hrs, pct, src, late: late || 0 });
  const G = 'General · 09:30–18:30', E = 'Early · 07:00–16:00', N = 'Night · 21:00–06:00';
  const people = [
    P('EMP-0101', 'Priya Sharma', 'Engineering', 'Senior Engineer', 'Bengaluru HQ', 'Siddharth Rao', '12 Mar 2022', 'Full-time', 'Active', G, 'present', '09:24', '—', '4h 46m', 53, 'Face · BLR-HQ'),
    P('EMP-0114', 'Rahul Kumar', 'Sales', 'Account Executive', 'Hyderabad', 'Rohan Das', '3 Jan 2024', 'Full-time', 'Active', G, 'late', '09:52', '—', '4h 18m', 48, 'Mobile · geofence', 22),
    P('EMP-0122', 'Ananya Iyer', 'Design', 'Product Designer', 'Pune', 'Kiran Rao', '18 Jul 2023', 'Full-time', 'Active', G, 'wfh', '09:10', '—', '5h 00m', 56, 'Web · home'),
    P('EMP-0131', 'Mohammed Arif', 'Operations', 'Operations Lead', 'Bengaluru HQ', 'Deepa Nair', '28 Sep 2021', 'Full-time', 'Active', E, 'present', '06:58', '—', '7h 12m', 80, 'Face · BLR-HQ'),
    P('EMP-0142', 'Sneha Reddy', 'HR', 'HR Generalist', 'Hyderabad', 'Meera Joshi', '9 May 2023', 'Full-time', 'Active', G, 'leave', '—', '—', '—', 0, 'Casual leave · 25–26 Sep'),
    P('EMP-0156', 'Vikram Singh', 'Finance', 'Accountant', 'Bengaluru HQ', 'Ishita Verma', '14 Feb 2022', 'Full-time', 'Active', G, 'none', '—', '—', '—', 0, 'No punch yet'),
    P('EMP-0163', 'Kavya Menon', 'Engineering', 'Software Engineer II', 'Bengaluru HQ', 'Siddharth Rao', '6 Jun 2024', 'Full-time', 'Active', G, 'present', '09:31', '—', '4h 39m', 52, 'Face · BLR-HQ'),
    P('EMP-0170', 'Arjun Nair', 'Support', 'Support Specialist', 'Bengaluru HQ', 'Deepa Nair', '2 Nov 2023', 'Full-time', 'Active', N, 'absent', '—', '—', '—', 0, 'Missed last night'),
    P('EMP-0178', 'Neha Kapoor', 'Marketing', 'Marketing Manager', 'Bengaluru HQ', 'Demo Owner', '21 Aug 2020', 'Full-time', 'Active', G, 'present', '09:05', '—', '5h 05m', 56, 'Face · BLR-HQ'),
    P('EMP-0185', 'Siddharth Rao', 'Engineering', 'Engineering Manager', 'Pune', 'Demo Owner', '4 Apr 2019', 'Full-time', 'Active', G, 'present', '09:18', '—', '4h 52m', 54, 'Mobile · geofence'),
    P('EMP-0192', 'Farah Khan', 'Design', 'UX Researcher', 'Bengaluru HQ', 'Kiran Rao', '11 Oct 2024', 'Full-time', 'Active', G, 'wfh', '09:40', '—', '4h 30m', 50, 'Web · home'),
    P('EMP-0203', 'Rohan Das', 'Sales', 'Sales Manager', 'Hyderabad', 'Demo Owner', '15 Jan 2021', 'Full-time', 'Notice period', G, 'late', '10:04', '—', '4h 06m', 46, 'Mobile · geofence', 34),
    P('EMP-0211', 'Ishita Verma', 'Finance', 'Payroll Specialist', 'Bengaluru HQ', 'Demo Owner', '1 Dec 2022', 'Full-time', 'Active', G, 'present', '09:12', '—', '4h 58m', 55, 'Face · BLR-HQ'),
    P('EMP-0219', 'Karthik Subramanian', 'Operations', 'Warehouse Supervisor', 'Pune', 'Mohammed Arif', '7 Mar 2023', 'Contract', 'Suspended', E, 'present', '07:02', '—', '7h 08m', 79, 'Face · PUN'),
    P('EMP-0224', 'Meera Joshi', 'HR', 'Talent Partner', 'Bengaluru HQ', 'Demo Owner', '1 Jul 2026', 'Full-time', 'Probation', G, 'present', '09:27', '—', '4h 43m', 52, 'Face · BLR-HQ'),
    P('EMP-0230', 'Aditya Bose', 'Engineering', 'Engineering Intern', 'Bengaluru HQ', 'Priya Sharma', '7 Sep 2026', 'Intern', 'Probation', G, 'present', '09:29', '—', '4h 41m', 52, 'Face · BLR-HQ'),
    P('EMP-0097', 'Tanvi Shah', 'Marketing', 'Content Lead', 'Bengaluru HQ', 'Neha Kapoor', '10 Jun 2021', 'Full-time', 'Exited', G, 'none', '—', '—', '—', 0, 'Exited 31 Aug 2026')
  ];
  const dash = {
    donut: [['Present', 142, 'var(--u-br,#0F6E56)'], ['Work from home', 45, 'var(--u-g2,#5FB39C)'], ['On leave', 12, 'var(--u-g3,#A9D6C6)'], ['Absent', 24, 'var(--u-rd,#C4453A)'], ['Not marked', 18, 'var(--u-gy,#C9D2CE)']],
    arrivals: [['07:00', 6], ['07:30', 9], ['08:00', 14], ['08:30', 28], ['09:00', 61], ['09:30', 44], ['10:00', 17], ['10:30', 6], ['11:00', 2]],
    approvals: [
      { id: 'a1', name: 'Priya Sharma', kind: 'Casual leave', what: '28–29 Sep · 2 days', when: '12 min ago', icon: 'calendar' },
      { id: 'a2', name: 'Rahul Kumar', kind: 'Regularisation', what: 'Missed punch-out on 23 Sep', when: '40 min ago', icon: 'clock' },
      { id: 'a3', name: 'Ananya Iyer', kind: 'Work from home', what: 'Wed, 30 Sep', when: '1 hr ago', icon: 'home' },
      { id: 'a4', name: 'Mohammed Arif', kind: 'Expense claim', what: '₹4,860 · client visit travel', when: '2 hr ago', icon: 'receipt' },
      { id: 'a5', name: 'Kavya Menon', kind: 'Earned leave', what: '5–9 Oct · 5 days', when: '3 hr ago', icon: 'calendar' },
      { id: 'a6', name: 'Farah Khan', kind: 'Shift change', what: 'General → Evening from 1 Oct', when: 'Yesterday', icon: 'alarm' }
    ],
    depts: [['Engineering', 72], ['Sales', 44], ['Operations', 39], ['Support', 31], ['Design', 19], ['Marketing', 16], ['Finance', 15], ['HR', 13]],
    upcoming: [
      { d: '26', m: 'Sep', title: 'Kavya Menon’s birthday', sub: 'Saturday · Engineering', icon: 'gift' },
      { d: '28', m: 'Sep', title: 'Mohammed Arif · 5 years', sub: 'Monday · work anniversary', icon: 'award' },
      { d: '28', m: 'Sep', title: '2 new joiners start', sub: 'Monday · Sales and Design', icon: 'userPlus' },
      { d: '02', m: 'Oct', title: 'Gandhi Jayanti', sub: 'Friday · public holiday', icon: 'flag' }
    ],
    activity: [
      { title: 'Ishita Verma locked September attendance for payroll', meta: 'Payroll · 2 hr ago' },
      { title: 'Meera Joshi scheduled 2 new hires for 28 Sep', meta: 'Hiring · 3 hr ago' },
      { title: 'Neha Kapoor approved 3 leave requests', meta: 'Leave · 4 hr ago' },
      { title: 'Pune Office geofence radius set to 120 m', meta: 'Company · Yesterday' },
      { title: 'August payslips published to 228 employees', meta: 'Payroll · 2 Sep' }
    ]
  };
  const L = (id, code, name, dept, type, dates, days, reason, applied, bal, conflict, status, by) => ({ id, code, name, dept, type, dates, days, reason, applied, bal, conflict: conflict || '', status: status || 'Pending', by: by || '' });
  const leaves = [
    L('L-2091', 'EMP-0101', 'Priya Sharma', 'Engineering', 'Casual leave', '28–29 Sep', '2 days', 'Family function in Pune', '12 min ago', '4.5 of 12 left after this'),
    L('L-2090', 'EMP-0163', 'Kavya Menon', 'Engineering', 'Earned leave', '5–9 Oct', '5 days', 'Annual trip with family', '3 hr ago', '5 of 15 left after this', '3 others in Engineering are off on 6 Oct'),
    L('L-2088', 'EMP-0114', 'Rahul Kumar', 'Sales', 'Sick leave', 'Thu, 24 Sep', '1 day', 'Fever. Doctor’s note attached', 'Yesterday', '5 of 7 left after this'),
    L('L-2087', 'EMP-0192', 'Farah Khan', 'Design', 'Casual leave', 'Wed, 30 Sep', 'Half day', 'Bank appointment in the afternoon', 'Yesterday', '7.5 of 12 left after this'),
    L('L-2085', 'EMP-0219', 'Karthik Subramanian', 'Operations', 'Comp-off', 'Thu, 1 Oct', '1 day', 'Worked Sunday 20 Sep for the stock audit', '2 days ago', '1 of 2 left after this'),
    L('L-2084', 'EMP-0178', 'Neha Kapoor', 'Marketing', 'Earned leave', '12–16 Oct', '5 days', 'Trip to Kerala', '2 days ago', '8 of 15 left after this', 'Overlaps the Q3 campaign launch on 14 Oct'),
    L('L-2083', 'EMP-0230', 'Aditya Bose', 'Engineering', 'Casual leave', 'Thu, 1 Oct', '1 day', 'College convocation', '3 days ago', 'No casual leave left', 'Will be unpaid (loss of pay)'),
    L('L-2082', 'EMP-0156', 'Vikram Singh', 'Finance', 'Sick leave', '22–23 Sep', '2 days', 'Viral infection', '3 days ago', '3 of 7 left after this'),
    L('L-2081', 'EMP-0224', 'Meera Joshi', 'HR', 'Casual leave', 'Fri, 9 Oct', '1 day', 'Personal work', '4 days ago', '9 of 12 left after this'),
    L('L-2079', 'EMP-0142', 'Sneha Reddy', 'HR', 'Casual leave', '25–26 Sep', '2 days', 'Sister’s wedding', '20 Sep', '', '', 'Approved', 'You · 20 Sep'),
    L('L-2076', 'EMP-0185', 'Siddharth Rao', 'Engineering', 'Earned leave', '19–23 Oct', '5 days', 'Family vacation', '18 Sep', '', '', 'Approved', 'You · 18 Sep'),
    L('L-2072', 'EMP-0203', 'Rohan Das', 'Sales', 'Casual leave', 'Tue, 29 Sep', '1 day', 'Personal', '17 Sep', '', 'Serving notice: leave needs HR head approval', 'Rejected', 'You · 17 Sep')
  ];
  const offWeek = [
    { day: 'Mon', date: '28', names: ['Priya Sharma', 'Sneha Reddy', 'Arjun Nair'], more: 1 },
    { day: 'Tue', date: '29', names: ['Priya Sharma', 'Vikram Singh'], more: 1 },
    { day: 'Wed', date: '30', names: ['Farah Khan'], more: 1 },
    { day: 'Thu', date: '1', names: ['Karthik Subramanian', 'Aditya Bose'], more: 3 },
    { day: 'Fri', date: '2', names: [], more: 0, holiday: 'Gandhi Jayanti' }
  ];
  const leaveTypes = [['Casual leave', 612, 1488], ['Earned leave', 820, 1860], ['Sick leave', 205, 868], ['Comp-off', 38, 96]];
  const pay = {
    employees: 231, gross: 6248900, ded: 871200, net: 5377700, employer: 6910400,
    steps: [['Draft', 'Created 24 Sep · Ishita Verma', 'done'], ['Processed', '25 Sep · 231 payslips', 'done'], ['Locked', 'Not yet · 6 flags open', 'current'], ['Paid', 'Bank file after lock', 'todo']],
    rows: [
      ['EMP-0101', 'Priya Sharma', 'Engineering', '30 / 30', '', 145000, 18600, 0, 'Ready', ''],
      ['EMP-0114', 'Rahul Kumar', 'Sales', '30 / 30', '', 68400, 5900, 18.4, 'Review', 'Sales incentive ₹10,600'],
      ['EMP-0122', 'Ananya Iyer', 'Design', '30 / 30', '', 92000, 9800, 0, 'Ready', ''],
      ['EMP-0131', 'Mohammed Arif', 'Operations', '30 / 30', '', 88600, 8900, 12.6, 'Review', '14 h overtime'],
      ['EMP-0142', 'Sneha Reddy', 'HR', '30 / 30', '', 61000, 5200, 0, 'Ready', ''],
      ['EMP-0156', 'Vikram Singh', 'Finance', '28 / 30', '2 LOP', 58900, 5100, -6.7, 'Ready', ''],
      ['EMP-0170', 'Arjun Nair', 'Support', '26 / 30', '4 LOP', 34700, 2900, -13.3, 'Review', '4 days loss of pay'],
      ['EMP-0203', 'Rohan Das', 'Sales', '30 / 30', '', 112000, 14200, 0, 'On hold', 'Full & final in progress'],
      ['EMP-0219', 'Karthik Subramanian', 'Operations', '30 / 30', '', 49800, 4300, 4.2, 'Ready', ''],
      ['EMP-0230', 'Aditya Bose', 'Engineering', '24 / 30', 'Joined 7 Sep', 20000, 0, null, 'Review', 'New joiner · prorated stipend']
    ],
    mix: [['Basic', 3120000, 'var(--u-br,#0F6E56)'], ['HRA', 1250000, 'var(--u-g2,#5FB39C)'], ['Special allowance', 1190000, 'var(--u-g3,#A9D6C6)'], ['Overtime', 310000, 'var(--u-gd,#C8912E)'], ['Incentives', 380000, 'var(--u-gy,#C9D2CE)']],
    checks: [
      ['6 employees changed more than 10% from August', 'Review', 'warn'],
      ['2 employees are missing bank details', 'Fix now', 'bad'],
      ['1 new joiner is prorated from 7 Sep', 'View', 'ok'],
      ['Full & final for Rohan Das is on hold', 'Open', 'warn']
    ],
    statutory: [['Provident fund', 412300, '15 Oct'], ['ESI', 61200, '15 Oct'], ['Professional tax', 46200, '20 Oct'], ['TDS', 338900, '7 Oct']]
  };
  const reports = [
    { key: 'headcount', cat: 'People', title: 'Headcount', desc: 'Active, probation and notice-period headcount by department, as of any date.', updated: 'Updated 2 hr ago', kind: 'bars', data: [72, 44, 39, 31, 19, 16, 15, 13], pinned: true },
    { key: 'attrition', cat: 'People', title: 'Attrition', desc: 'Monthly exits, resignations, terminations and attrition percentage.', updated: 'Updated yesterday', kind: 'line', data: [3.2, 3.8, 4.4, 4.1, 3.6, 4.1, 3.9] },
    { key: 'diversity', cat: 'People', title: 'Diversity', desc: 'Headcount by gender and department for the active workforce.', updated: 'Updated 3 days ago', kind: 'split', data: [62, 38] },
    { key: 'attsum', cat: 'Time', title: 'Attendance summary', desc: 'Present days, late days, average hours and overtime per employee for a period.', updated: 'Updated 1 hr ago', kind: 'bars', data: [88, 92, 90, 94, 91, 93, 95], pinned: true },
    { key: 'late', cat: 'Time', title: 'Late marks', desc: 'Every late arrival with minutes late and check-in time for a date range.', updated: 'Updated today, 10:15', kind: 'line', data: [12, 9, 14, 8, 11, 7, 8] },
    { key: 'leavebal', cat: 'Time', title: 'Leave balance', desc: 'Entitlement, used, pending, carry-forward and available leave per employee.', updated: 'Updated today, 08:00', kind: 'split', data: [44, 56] }
  ];
  const schedules = [
    ['Headcount', 'Every Monday, 09:00', 'Leadership team · 4 people'],
    ['Late marks', 'Every weekday, 11:00', 'Branch managers · 3 people'],
    ['Attendance summary', '1st of every month', 'Payroll team · 2 people']
  ];
  const me = {
    name: 'Priya Sharma', first: 'Priya', code: 'EMP-0101', role: 'Senior Engineer', dept: 'Engineering', manager: 'Siddharth Rao',
    shift: 'General · 09:30–18:30', inT: '09:24', worked: '4h 46m', left: '4h 14m', pct: 53, nowPct: 52,
    month: [['Present', '18', 'days', 'userCheck', 'brand'], ['Late', '2', 'days', 'alarm', 'gold'], ['Absent', '1', 'day', 'xCircle', 'red'], ['On leave', '2', 'days', 'calendar', 'gray'], ['Attendance score', '95%', 'this month', 'target', 'brand']],
    balances: [['Casual', 6.5, 12], ['Earned', 10, 15], ['Sick', 4, 7], ['Comp-off', 1, 2]],
    requests: [
      ['Casual leave', '28–29 Sep · 2 days', 'Pending', 'warn', 'With Siddharth Rao'],
      ['Work from home', 'Wed, 30 Sep', 'Pending', 'warn', 'With Siddharth Rao'],
      ['Shift change', 'Evening from 1 Oct', 'Pending', 'warn', 'With HR'],
      ['Earned leave', '5–9 Oct · 5 days', 'Awaiting HR', 'info', 'Approved by manager'],
      ['Casual leave', '18–19 Sep · 2 days', 'Approved', 'ok', 'By Siddharth Rao']
    ],
    slip: { month: 'August 2026', net: 126400, gross: 145000, ded: 18600, paid: 'Paid 31 Aug' },
    ctc: 1800000,
    holidays: [['02', 'Oct', 'Gandhi Jayanti', 'Friday'], ['20', 'Oct', 'Dussehra', 'Tuesday'], ['08', 'Nov', 'Diwali', 'Sunday']],
    onboarding: [['Upload documents', true], ['Add bank details', true], ['Collect laptop', true], ['Accept policies', false], ['Add emergency contact', false]]
  };
  const companies = [
    { id: 'co-demo', name: 'Demo Technologies Pvt Ltd', short: 'DT', legal: 'Demo Technologies Private Limited', industry: 'IT Services', country: 'India', currency: 'INR', hq: 'Bengaluru Head Office', cin: 'U72200KA2019PTC999001', pan: 'DEMCX0001Z', gstin: '29DEMCX0001Z1ZQ', employees: 30, next: 'EMP-0031' },
    { id: 'co-retail', name: 'Demo Retail Pvt Ltd', short: 'DR', legal: 'Demo Retail Private Limited', industry: 'Retail', country: 'India', currency: 'INR', hq: 'Mumbai Flagship Store', cin: 'U52100MH2016PTC281734', pan: 'AAKCD4821M', gstin: '27AAKCD4821M1Z5', employees: 142, next: 'DRT-0143' },
    { id: 'co-found', name: 'Demo Foundation', short: 'DF', legal: 'Demo Foundation (Section 8 Company)', industry: 'Non-profit', country: 'India', currency: 'INR', hq: 'Chennai Office', cin: 'U85300TN2021NPL141122', pan: 'AAGCD7731K', gstin: '—', employees: 6, next: 'DFN-0007' }
  ];
  const B = (id, co, name, code, city, state, emp, hq, active, geo, radius) => ({ id, co, name, code, city, state, emp, hq: !!hq, active: active !== false, geo: !!geo, radius: radius || 100 });
  const branches = [
    B('b-blr', 'co-demo', 'Bengaluru Head Office', 'BLR-HQ', 'Bengaluru', 'Karnataka', 18, 1, true, 1, 150),
    B('b-hyd', 'co-demo', 'Hyderabad Office', 'HYD', 'Hyderabad', 'Telangana', 6, 0, true, 0),
    B('b-pun', 'co-demo', 'Pune Office', 'PUN', 'Pune', 'Maharashtra', 6, 0, true, 1, 120),
    B('r-mum1', 'co-retail', 'Mumbai Flagship Store', 'MUM-01', 'Mumbai', 'Maharashtra', 34, 1, true, 1, 150),
    B('r-mum2', 'co-retail', 'Andheri Store', 'MUM-02', 'Mumbai', 'Maharashtra', 18, 0, true, 1),
    B('r-thn', 'co-retail', 'Thane Warehouse', 'THN-WH', 'Thane', 'Maharashtra', 26, 0, true, 1, 250),
    B('r-pun', 'co-retail', 'Pune Store', 'PUN-01', 'Pune', 'Maharashtra', 15, 0, true, 1),
    B('r-amd', 'co-retail', 'Ahmedabad Store', 'AMD-01', 'Ahmedabad', 'Gujarat', 14, 0, true, 0),
    B('r-srt', 'co-retail', 'Surat Store', 'SRT-01', 'Surat', 'Gujarat', 12, 0, true, 1),
    B('r-jai', 'co-retail', 'Jaipur Store', 'JAI-01', 'Jaipur', 'Rajasthan', 11, 0, true, 0),
    B('r-idr', 'co-retail', 'Indore Store', 'IDR-01', 'Indore', 'Madhya Pradesh', 9, 0, true, 1, 120),
    B('r-nsk', 'co-retail', 'Nashik Store', 'NSK-01', 'Nashik', 'Maharashtra', 0, 0, false, 0),
    B('f-chn', 'co-found', 'Chennai Office', 'CHN', 'Chennai', 'Tamil Nadu', 6, 1, true, 0)
  ];
  const profile = {
    'EMP-0101': {
      phone: '+91 98450 21734', grade: 'L3', since: '4 yrs 6 mos', probation: 'Completed 12 Sep 2022', cost: 'ENG-BLR', company: 'Demo Technologies Pvt Ltd',
      attention: [['1 unmarked day this week', 'Tue, 22 Sep has no punch-out', 'See attendance', 'warn'], ['2 documents to review', 'PAN card and address proof', 'Review', 'ok'], ['Self-review due 30 Sep', 'H2 appraisal cycle', 'Open', 'info']],
      glance: [['This week', '26h 40m', 'of 45h scheduled', 'clock', 'brand'], ['Annual CTC', '₹18,00,000', 'since Apr 2026', 'wallet', 'brand'], ['Documents', '5 of 7', '2 waiting for review', 'file', 'gold'], ['Goals', '4 of 6', 'on track this cycle', 'target', 'brand']],
      month: 'ppppppwpppplpppppaoopp'.split(''),
      earnings: [['Basic', 60000], ['House rent allowance', 30000], ['Special allowance', 47000], ['Leave travel allowance', 8000]],
      deductions: [['Provident fund', 7200], ['Professional tax', 200], ['Income tax (TDS)', 11200]]
    }
  };
  window.UTD = { TONE, pill, ini, money, lakh, ATT, people, dash, leaves, offWeek, leaveTypes, pay, reports, schedules, me, companies, branches, profile, today: 'Friday, 25 September 2026', now: '2:10 PM' };
})();
