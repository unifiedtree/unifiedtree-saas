// Dashboard data for the HRMS redesign: a lived-in sample account and an empty (new) account.
(() => {
  if (window.UTDash) return;
  const I = {
    megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
    cake: 'M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01',
    award: 'M15.48 12.89 17 22l-5-3-5 3 1.52-9.11M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
    star: 'M11.52 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z',
    clipboard: 'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 14l2 2 4-4',
    calClock: 'M16 14v2.2l1.6 1M16 2v4M8 2v4M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M3 10h5M16 22a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
    swap: 'M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4',
    calPlus: 'M8 2v4M16 2v4M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M3 10h18M19 16v6M16 19h6',
    alert: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01',
    userMinus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 11h-6',
    half: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 2v20M12 7h5M12 12h7M12 17h5',
    help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
    seat: 'M7 13V6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v7M5 13h14a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1zM7 18v3M17 18v3',
    pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
    kanban: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7v7M12 7v4M16 7v9',
    bars: 'M3 3v18h18M7 16v-4M11 16V8M15 16v-6M19 16V5',
    check: 'M20 6 9 17l-5-5',
    lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4'
  };
  // Working days this week, Mon 21 – Fri 25 Sep 2026. Present includes late and half-day.
  const WEEK = [
    { short: 'Mon, 21 Sep', full: 'Mon, 21 Sep 2026', present: 150, late: 11, leave: 9, half: 2, wfh: 44, none: 12, absent: 26 },
    { short: 'Tue, 22 Sep', full: 'Tue, 22 Sep 2026', present: 146, late: 9, leave: 10, half: 4, wfh: 47, none: 14, absent: 24 },
    { short: 'Wed, 23 Sep', full: 'Wed, 23 Sep 2026', present: 148, late: 12, leave: 11, half: 3, wfh: 43, none: 16, absent: 23 },
    { short: 'Thu, 24 Sep', full: 'Thu, 24 Sep 2026', present: 145, late: 10, leave: 11, half: 2, wfh: 46, none: 15, absent: 24 },
    { short: 'Fri, 25 Sep', full: 'Fri, 25 Sep 2026', present: 142, late: 8, leave: 12, half: 3, wfh: 45, none: 18, absent: 24 }
  ];
  const ZWEEK = WEEK.map(w => ({ short: w.short, full: w.full, present: 0, late: 0, leave: 0, half: 0, wfh: 0, none: 0, absent: 0 }));
  // Chart columns: last 7 calendar days; index into WEEK, null = weekly off.
  const CAL = [['Sat', '19', null], ['Sun', '20', null], ['Mon', '21', 0], ['Tue', '22', 1], ['Wed', '23', 2], ['Thu', '24', 3], ['Fri', '25', 4]];
  // Sparklines: last 7 working days (Thu 17, Fri 18, Mon 21 … Fri 25). WEEK[i] sits at index i + 2.
  const SPARK = {
    total: [243, 244, 246, 247, 247, 248, 249], present: [144, 139, 150, 146, 148, 145, 142], leave: [9, 10, 9, 10, 11, 11, 12], late: [13, 12, 11, 9, 12, 10, 8],
    half: [2, 4, 2, 4, 3, 2, 3], wfh: [43, 47, 44, 47, 43, 46, 45], none: [16, 14, 12, 14, 16, 15, 18], absent: [29, 27, 26, 24, 23, 24, 24]
  };
  const ZSPARK = Object.keys(SPARK).reduce((o, k) => (o[k] = [0, 0, 0, 0, 0, 0, 0], o), {});
  // Quick actions: key, label, icon, uses this month, default rank for a new account.
  const QUICK = [
    ['att', 'Attendance', 'clock', 48, 0], ['shift', 'Change shifts', 'swap', 17, 1], ['off', 'Add time-off', 'calPlus', 14, 2], ['pay', 'Run payroll', 'rupee', 12, 3],
    ['rep', 'View reports', 'file', 22, 4], ['org', 'Org setup', 'building', 5, 5], ['leave', 'Approve leave', 'calCheck', 41, 6], ['fix', 'Regularise', 'timer', 26, 7],
    ['add', 'Add employee', 'userPlus', 9, 8], ['note', 'Post a notice', 'megaphone', 6, 9]
  ];
  const sample = {
    sched: 241, total: 249, joined: 6, seats: { used: 249, total: 260 },
    inbox: {
      counts: { att: 6, fix: 4, leave: 9 },
      items: [
        { id: 'i1', type: 'leave', name: 'Priya Sharma', kind: 'Casual leave', what: '28–29 Sep · 2 days', when: '12 min ago' },
        { id: 'i2', type: 'att', name: 'Farah Khan', kind: 'No punch today', what: 'Not on leave · General shift', when: '09:45' },
        { id: 'i3', type: 'fix', name: 'Rahul Kumar', kind: 'Missed punch-out', what: 'Wed, 23 Sep · asks for 18:40', when: '40 min ago' },
        { id: 'i4', type: 'leave', name: 'Kavya Menon', kind: 'Earned leave', what: '5–9 Oct · 5 days', when: '3 hr ago' },
        { id: 'i5', type: 'att', name: 'Arjun Nair', kind: 'Outside geofence', what: 'Punched 1.2 km from Pune Office', when: '09:31' },
        { id: 'i6', type: 'fix', name: 'Vikram Singh', kind: 'Late mark correction', what: 'Tue, 22 Sep · traffic on ORR', when: '2 hr ago' },
        { id: 'i7', type: 'leave', name: 'Ananya Iyer', kind: 'Work from home', what: 'Wed, 30 Sep · 1 day', when: '1 hr ago' },
        { id: 'i8', type: 'att', name: 'Sneha Reddy', kind: 'Early punch-out', what: 'Left 15:10 · no half-day request', when: 'Yesterday' }
      ]
    },
    today: [
      ['Vikram Singh', 'Operations', '10:02', 'late'], ['Rahul Kumar', 'Sales', '09:52', 'late'], ['Sneha Reddy', 'Design', '09:41', 'present'],
      ['Priya Sharma', 'Engineering', '09:24', 'present'], ['Ananya Iyer', 'Design', '09:18', 'wfh'], ['Neha Kapoor', 'Marketing', '09:12', 'wfh'],
      ['Mohammed Arif', 'Sales', '09:05', 'present'], ['Farah Khan', 'Support', '—', 'none'], ['Arjun Nair', 'Operations', '—', 'none'], ['Kavya Menon', 'Engineering', '—', 'leave']
    ],
    notices: [
      { title: 'Office closed for Gandhi Jayanti', meta: 'Fri, 2 Oct · Everyone' },
      { title: 'Q3 town hall on 8 Oct, 4:00 PM', meta: 'Posted yesterday · Everyone' },
      { title: 'New travel policy is live', meta: '21 Sep · Sales and Operations' }
    ],
    birthdays: [['Kavya Menon', 'Engineering', 'Sat, 26 Sep', 'Tomorrow'], ['Arjun Nair', 'Operations', 'Wed, 30 Sep', 'In 5 days'], ['Sneha Reddy', 'Design', 'Tue, 6 Oct', 'In 11 days']],
    anniv: [['Mohammed Arif', '5 years · Sales', 'Mon, 28 Sep', 'In 3 days'], ['Neha Kapoor', '3 years · Marketing', 'Thu, 15 Oct', 'In 20 days']],
    retire: [['K. Venkatesh', 'Finance · turns 60', 'Sun, 31 Jan 2027', 'In 4 months']],
    probation: [
      { id: 'p1', name: 'Aditya Rao', role: 'Engineering · SDE II', ends: 'Mon, 5 Oct', left: 'In 10 days' },
      { id: 'p2', name: 'Pooja Menon', role: 'Support · Team lead', ends: 'Thu, 8 Oct', left: 'In 13 days' },
      { id: 'p3', name: 'Karan Malhotra', role: 'Sales · Account executive', ends: 'Mon, 19 Oct', left: 'In 24 days' }
    ],
    depts: [['Engineering', 72], ['Sales', 44], ['Operations', 39], ['Support', 31], ['Design', 19], ['Marketing', 16], ['Finance', 15], ['HR', 13]],
    rating: '4.2', reviews: 186,
    performers: [['Priya Sharma', 'Engineering', '4.8'], ['Mohammed Arif', 'Sales', '4.7'], ['Ananya Iyer', 'Design', '4.6'], ['Vikram Singh', 'Operations', '4.5']],
    onboarding: [['Nikhil Jain', 'Sales · joined 21 Sep', 7, 10], ['Aisha Khan', 'Design · joined 14 Sep', 9, 10], ['Varun Shetty', 'Engineering · starts 28 Sep', 2, 10]],
    pipeline: { open: 7, stages: [['Applied', 128], ['Screening', 46], ['Interview', 18], ['Offer', 5], ['Hired', 3]] },
    projects: [['Payroll automation', 'Ishita Verma', 72, 'ok', 'Due 30 Sep'], ['Q3 appraisal cycle', 'Neha Kapoor', 60, 'ok', 'Due 20 Oct'], ['Hyderabad office move', 'Rohan Das', 45, 'warn', 'Due 12 Oct'], ['Mobile app pilot', 'Siddharth Rao', 30, 'bad', 'Due 5 Oct']],
    payroll: [['Oct', 55.2], ['Nov', 55.9], ['Dec', 57.4], ['Jan', 57.8], ['Feb', 58.3], ['Mar', 60.9], ['Apr', 59.6], ['May', 60.2], ['Jun', 60.8], ['Jul', 61.2], ['Aug', 61.2], ['Sep', 62.5, 1]],
    activity: [
      ['Ishita Verma locked September attendance for payroll', 'Payroll · 2 hr ago', 'lock'], ['Meera Joshi scheduled 2 new hires for 28 Sep', 'Hiring · 3 hr ago', 'userPlus'],
      ['Neha Kapoor approved 3 leave requests', 'Leave · 4 hr ago', 'calCheck'], ['Pune Office geofence radius set to 120 m', 'Company · Yesterday', 'mapPin'],
      ['August payslips published to 228 employees', 'Payroll · 2 Sep', 'file']
    ]
  };
  const empty = {
    sched: 0, total: 0, joined: 0, seats: { used: 1, total: 1 },
    inbox: { counts: { att: 0, fix: 0, leave: 0 }, items: [] },
    today: [], notices: [], birthdays: [], anniv: [], retire: [], probation: [], depts: [], rating: '', reviews: 0, performers: [], onboarding: [],
    pipeline: null, projects: [], payroll: [], activity: []
  };
  window.UTDash = { I, WEEK, ZWEEK, CAL, SPARK, ZSPARK, QUICK, sample, empty };
})();
