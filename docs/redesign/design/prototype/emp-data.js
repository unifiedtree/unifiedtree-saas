// Demo data for the employee and manager experiences (Priya Sharma, and Siddharth Rao's team).
(() => {
  if (window.UTEmp) return;
  const me = { name: 'Priya Sharma', first: 'Priya', ini: 'PS', code: 'EMP-0101', role: 'Senior Engineer', dept: 'Engineering', branch: 'Bengaluru HQ', mgr: 'Siddharth Rao', joined: '12 Mar 2022', tenure: '4 years 6 months', shift: 'General shift', shiftTime: '09:30 – 18:30', grace: '15 min grace', in: '09:24', source: 'Face · Bengaluru HQ', worked: '4h 46m', nowPct: 53, inPct: 0, now: '2:10 PM', date: 'Friday, 25 September 2026' };

  // September 2026: 1 Sep is a Tuesday. P present, LT late, W work from home, H holiday, MP missed punch, T today, LV leave (pending), off weekends, blank future.
  const month = {
    label: 'September 2026', lead: 1, len: 30, today: 25,
    map: { 1: 'P', 2: 'P', 3: 'LT', 4: 'P', 7: 'P', 8: 'W', 9: 'P', 10: 'P', 11: 'LT', 14: 'H', 15: 'P', 16: 'W', 17: 'P', 18: 'MP', 21: 'P', 22: 'P', 23: 'W', 24: 'P', 25: 'T', 28: 'LV', 29: 'LV' },
    punch: { 1: ['09:21', '18:40', '9h 19m'], 2: ['09:26', '18:35', '9h 09m'], 3: ['09:48', '18:52', '9h 04m'], 4: ['09:18', '18:31', '9h 13m'], 7: ['09:25', '18:44', '9h 19m'], 8: ['09:05', '18:10', '9h 05m'], 9: ['09:22', '18:36', '9h 14m'], 10: ['09:27', '18:30', '9h 03m'], 11: ['09:51', '19:02', '9h 11m'], 15: ['09:20', '18:41', '9h 21m'], 16: ['09:02', '18:05', '9h 03m'], 17: ['09:24', '18:39', '9h 15m'], 18: ['09:23', '—', '—'], 21: ['09:19', '18:33', '9h 14m'], 22: ['09:28', '18:45', '9h 17m'], 23: ['09:08', '18:12', '9h 04m'], 24: ['09:22', '18:38', '9h 16m'], 25: ['09:24', '—', '4h 46m'] },
    notes: { 3: 'Checked in 18 min after shift start', 11: 'Checked in 21 min after shift start', 14: 'Ganesh Chaturthi · public holiday', 18: 'No punch-out recorded. Fix it before payroll locks on 28 Sep.', 28: 'Casual leave · waiting for Siddharth Rao', 29: 'Casual leave · waiting for Siddharth Rao' },
    stats: [['Present', '17', 'of 18 working days', 'ok'], ['Late', '2', '3 and 11 Sep', 'warn'], ['Work from home', '3', 'of 6 allowed', 'info'], ['Average day', '9h 12m', 'target 9h 00m', 'ok'], ['To fix', '1', 'missed punch-out', 'bad']]
  };

  const timesheet = { week: 'Mon 21 – Fri 25 Sep', days: ['Mon 21', 'Tue 22', 'Wed 23', 'Thu 24', 'Fri 25'], target: 8,
    rows: [['Payments v2', 'PAY-V2', [5.5, 6, 4, 5, 2.5]], ['API latency', 'PERF-Q3', [2, 1.5, 3, 2.5, 1]], ['Code review', 'ENG-OPS', [1, 1, 1.5, 1, 0.5]], ['Interviews', 'HIRING', [0, 0.5, 0, 0.75, 0]]] };

  const wfh = { used: 3, allowed: 6, month: 'September',
    dates: [['Mon', '28 Sep', 'leave'], ['Tue', '29 Sep', 'leave'], ['Wed', '30 Sep', ''], ['Thu', '1 Oct', ''], ['Fri', '2 Oct', 'holiday'], ['Mon', '5 Oct', ''], ['Tue', '6 Oct', ''], ['Wed', '7 Oct', ''], ['Thu', '8 Oct', ''], ['Fri', '9 Oct', '']],
    history: [['Wed 23 Sep', 'Internet technician visit', 'Approved', 'Siddharth Rao · 21 Sep'], ['Wed 16 Sep', 'Focus day for the refund flow', 'Approved', 'Siddharth Rao · 14 Sep'], ['Tue 8 Sep', 'Waiting for a delivery', 'Approved', 'Siddharth Rao · 7 Sep']] };

  const shifts = { current: 'General', options: [['Early', '07:00 – 16:00', 'Mon–Fri', '6 people'], ['General', '09:30 – 18:30', 'Mon–Fri', '41 people'], ['Late', '12:00 – 21:00', 'Mon–Fri', '9 people'], ['Evening', '14:00 – 23:00', 'Mon–Fri', '5 people']],
    history: [['Late shift for the release week', '3 – 7 Aug', 'Approved', 'Meera Joshi · 30 Jul'], ['Early shift during Ramzan', '2 – 27 Mar', 'Approved', 'Meera Joshi · 26 Feb']] };

  const leave = {
    bal: [['Casual leave', 6.5, 12, 'Resets on 1 Jan', 'brand'], ['Earned leave', 11, 18, '+1.5 days on 1 Oct', 'mint'], ['Sick leave', 5, 7, 'A note is needed after 2 days', 'gold'], ['Comp off', 1, 1, 'Use it by 30 Oct', 'gray']],
    optional: [1, 2],
    reqs: [
      { id: 'L-2091', type: 'Casual leave', dates: 'Mon 28 – Tue 29 Sep', days: '2 days', reason: 'Family function in Pune', status: 'Waiting', tone: 'warn', when: 'Today, 1:58 PM', step: 1, by: 'Siddharth Rao' },
      { id: 'L-1987', type: 'Earned leave', dates: 'Wed 19 – Fri 21 Aug', days: '3 days', reason: 'Trip to Coorg', status: 'Approved', tone: 'ok', when: '4 Aug', step: 3, by: 'Siddharth Rao · 5 Aug' },
      { id: 'L-1902', type: 'Sick leave', dates: 'Thu 2 Jul', days: '1 day', reason: 'Fever', status: 'Approved', tone: 'ok', when: '2 Jul', step: 3, by: 'Siddharth Rao · 2 Jul' },
      { id: 'L-1850', type: 'Casual leave', dates: 'Fri 12 Jun', days: '1 day', reason: 'Bank work', status: 'Cancelled', tone: 'gray', when: '8 Jun', step: 0, by: 'You · 10 Jun' }
    ],
    holidays: [['Fri', '2 Oct', 'Gandhi Jayanti', 'In 7 days', 'Long weekend if you take Thu 1 Oct'], ['Tue', '20 Oct', 'Vijayadashami', 'In 25 days', 'Take Mon 19 Oct for a 4-day break'], ['Sun', '1 Nov', 'Kannada Rajyotsava', 'In 5 weeks', 'Falls on a Sunday'], ['Tue', '10 Nov', 'Balipadyami, Deepavali', 'In 6 weeks', ''], ['Fri', '25 Dec', 'Christmas', 'In 3 months', 'Long weekend']],
    optList: [['Thu', '10 Sep', 'Mahalaya Amavasya', 'Taken'], ['Tue', '24 Nov', 'Guru Nanak Jayanti', 'Available'], ['Thu', '24 Dec', 'Christmas Eve', 'Available']],
    // October 2026 starts on a Thursday (3 blanks in a Monday-first grid).
    oct: { lead: 3, len: 31, off: [3, 4, 10, 11, 17, 18, 24, 25, 31], hol: [2, 20], team: { 5: 'Kavya', 6: 'Kavya', 7: 'Kavya, Arjun', 8: 'Kavya, Arjun', 9: 'Kavya' } }
  };

  const pay = {
    next: 'Wed, 30 Sep', inDays: 'in 5 days', net: '₹1,25,850', netMonth: 'August 2026', bank: 'HDFC Bank ••4821', ctc: '₹18,57,000', ctcMonth: '₹1,54,750',
    slips: [['Aug 2026', '₹1,25,850', 'Credited Mon, 31 Aug', 'Includes ₹1,000 internet claim'], ['Jul 2026', '₹1,24,850', 'Credited Fri, 31 Jul', ''], ['Jun 2026', '₹1,24,850', 'Credited Tue, 30 Jun', ''], ['May 2026', '₹1,24,850', 'Credited Fri, 29 May', ''], ['Apr 2026', '₹1,24,850', 'Credited Thu, 30 Apr', 'First month on the revised salary'], ['Mar 2026', '₹1,11,420', 'Credited Tue, 31 Mar', '']],
    earn: [['Basic', '₹61,900'], ['House rent allowance', '₹30,950'], ['Special allowance', '₹51,122'], ['Leave travel allowance', '₹5,000'], ['Internet reimbursement', '₹1,000']],
    ded: [['Income tax (TDS)', '₹22,122'], ['Provident fund', '₹1,800'], ['Professional tax', '₹200']],
    gross: '₹1,49,972', dedTotal: '₹24,122', days: ['31', '31', '0'],
    ytd: [['Gross paid', '₹7,45,860'], ['Tax deducted', '₹1,10,610'], ['PF (yours)', '₹9,000'], ['Tax regime', 'New regime']],
    // monthly CTC split; widths in % of ₹1,54,750
    ctcSplit: [['Basic', '₹61,900', '40%', 'brand'], ['HRA', '₹30,950', '20%', 'mint'], ['Special allowance', '₹51,122', '33%', 'pale'], ['LTA', '₹5,000', '3.2%', 'gold'], ['Employer PF', '₹1,800', '1.2%', 'gray'], ['Gratuity', '₹2,978', '1.9%', 'gray'], ['Health cover', '₹1,000', '0.6%', 'gray']],
    revisions: [['1 Apr 2026', '₹18,57,000', '+12.5%', 'Annual appraisal'], ['1 Apr 2025', '₹16,50,000', '+10%', 'Annual appraisal'], ['12 Sep 2022', '₹15,00,000', '', 'Confirmed after probation'], ['12 Mar 2022', '₹15,00,000', '', 'Joined']],
    claims: [
      { id: 'EXP-3312', title: 'Client visit travel', date: 'Mon, 21 Sep', amount: '₹4,860', items: '3 receipts · cab and meals', status: 'Waiting', tone: 'warn', who: 'With Siddharth Rao since 21 Sep', step: 1 },
      { id: 'EXP-3298', title: 'Team offsite lunch', date: 'Fri, 11 Sep', amount: '₹2,150', items: '1 receipt', status: 'Approved', tone: 'info', who: 'Paid with your September salary', step: 2 },
      { id: 'EXP-3240', title: 'Internet · August', date: 'Mon, 31 Aug', amount: '₹1,000', items: '1 receipt', status: 'Paid', tone: 'ok', who: 'Paid on 31 Aug', step: 3 }
    ],
    cats: [['Travel', 'Cabs, trains, flights'], ['Meals', 'Up to ₹1,500 a day'], ['Internet', '₹1,000 a month'], ['Client entertainment', 'Up to ₹10,000'], ['Other', 'Needs a note']],
    adv: { limit: '₹1,24,850', past: [['Salary advance', '₹40,000', 'Apr – Jul 2026', '4 × ₹10,000', 'Repaid']] }
  };

  const docs = {
    letters: [['Appraisal letter 2026', 'Sent by Meera Joshi · 22 Sep', 'sign'], ['Salary revision · Apr 2026', 'Signed 2 Apr 2026', 'done'], ['Confirmation letter', 'Issued 12 Sep 2022', 'done'], ['Appointment letter', 'Issued 12 Mar 2022', 'done'], ['Offer letter', 'Signed 2 Mar 2022', 'done']],
    files: [['PAN card', 'Verified · 14 Mar 2022', 'ok'], ['Aadhaar card', 'Verified · 14 Mar 2022', 'ok'], ['Address proof', 'HR asked for a clearer photo · 23 Sep', 'redo'], ['Bank proof', 'Verified · cancelled cheque', 'ok'], ['Degree certificate', 'Verified · 20 Mar 2022', 'ok'], ['Relieving letter', 'Verified · previous employer', 'ok']],
    assets: [['MacBook Pro 14″', 'UT-LAP-0231 · handed over 12 Mar 2024', 'ok'], ['Dell 27″ monitor', 'UT-MON-0187 · handed over 21 Sep', 'confirm'], ['ID card and access badge', 'UT-ID-0101 · Bengaluru HQ', 'ok'], ['Jabra headset', 'UT-AUD-0452 · handed over 3 Jan 2025', 'ok']],
    policies: [['Code of conduct 2026', 'Read and accept by Wed, 30 Sep', 'todo', '6 min read'], ['Work from home policy', 'Accepted 2 Jun 2026', 'done', ''], ['Travel and expense policy', 'Accepted 14 Apr 2026', 'done', ''], ['Prevention of sexual harassment', 'Accepted 3 Jan 2026', 'done', '']]
  };

  const grow = {
    cycle: 'Q3 2026 check-in', due: 'Wed, 30 Sep', steps: [['Goals set', 'Done · 3 Jul', 2], ['Your self-review', 'Due Wed, 30 Sep', 1], ['Siddharth’s review', 'By Fri, 9 Oct', 0], ['Shared with you', 'By Fri, 16 Oct', 0]],
    goals: [['Ship Payments v2 to every merchant', 'Rolled out to 70% of merchants', 70, '40%', 'track'], ['Cut p95 API latency to 180 ms', 'Now 212 ms, from 260 ms', 55, '30%', 'risk'], ['Mentor two new engineers', 'Sana and Aditya are onboarded', 100, '20%', 'done'], ['Finish the AWS architecture course', '4 of 10 modules', 40, '10%', 'track']],
    kudos: [['Siddharth Rao', 'Calm and quick on the refund incident. The write-up helped everyone.', '18 Sep'], ['Kavya Menon', 'Thanks for pairing on the webhook retries.', '9 Sep']],
    learn: [['POSH awareness 2026', 'Required · finish by Wed, 30 Sep', 0, '25 min', 'req'], ['Secure coding essentials', 'Assigned by Siddharth · due 15 Oct', 60, '2h left', 'as'], ['System design deep dive', 'You enrolled · no due date', 20, '5h left', 'self']],
    catalog: [['Giving useful feedback', '45 min · People skills'], ['Kubernetes for developers', '3h · Engineering'], ['Writing for work', '1h · Communication']]
  };

  // Siddharth Rao's team (Engineering). st: in, late, wfh, leave, none
  const team = [
    ['Priya Sharma', 'Senior Engineer', 'in', '09:24', 'Face · BLR-HQ', 'General'],
    ['Kavya Menon', 'Software Engineer', 'in', '09:18', 'Face · BLR-HQ', 'General'],
    ['Rohit Verma', 'DevOps Engineer', 'in', '08:55', 'Face · BLR-HQ', 'General'],
    ['Sana Qureshi', 'Software Engineer · joined 1 Sep', 'in', '09:12', 'Mobile · geofence', 'General'],
    ['Aditya Rao', 'SDE II · probation', 'late', '09:58', 'Face · BLR-HQ', 'General'],
    ['Aditya Bose', 'Software Engineer', 'wfh', '09:40', 'Web · home', 'General'],
    ['Arjun Nair', 'QA Lead', 'leave', '', 'Sick leave · today', 'Evening'],
    ['Divya Pillai', 'QA Engineer', 'none', '', 'No punch yet', 'General']
  ];
  // Mon 28 Sep – Sun 4 Oct. Codes: G General, E Early, V Evening, L leave, LP leave pending, W wfh, WP wfh pending, H holiday, O off
  const week = { label: 'Mon 28 Sep – Sun 4 Oct', days: ['Mon 28', 'Tue 29', 'Wed 30', 'Thu 1', 'Fri 2', 'Sat 3', 'Sun 4'],
    rows: [['Priya Sharma', ['LP', 'LP', 'G', 'G', 'H', 'O', 'O']], ['Kavya Menon', ['G', 'G', 'G', 'G', 'H', 'O', 'O']], ['Rohit Verma', ['G', 'G', 'G', 'G', 'H', 'O', 'O']], ['Sana Qureshi', ['G', 'G', 'W', 'G', 'H', 'O', 'O']], ['Aditya Rao', ['G', 'G', 'G', 'G', 'H', 'O', 'O']], ['Aditya Bose', ['G', 'G', 'G', 'LP', 'H', 'O', 'O']], ['Arjun Nair', ['V', 'V', 'V', 'V', 'H', 'O', 'O']], ['Divya Pillai', ['G', 'G', 'WP', 'G', 'H', 'O', 'O']]] };

  const approvals = [
    { id: 'ap1', kind: 'Leave', who: 'Priya Sharma', what: 'Casual leave · Mon 28 – Tue 29 Sep', n: '2 days', reason: 'Family function in Pune', when: '12 min ago', facts: [['Balance after', '4.5 casual days'], ['Others out', 'No one']], flag: '' },
    { id: 'ap2', kind: 'Leave', who: 'Kavya Menon', what: 'Earned leave · Mon 5 – Fri 9 Oct', n: '5 days', reason: 'Family trip to Kerala', when: '3 hr ago', facts: [['Balance after', '6 earned days'], ['Others out', 'Arjun Nair · 7–8 Oct']], flag: 'Two of eight people out on 7–8 Oct' },
    { id: 'ap3', kind: 'Leave', who: 'Aditya Bose', what: 'Casual leave · Thu 1 Oct', n: '1 day', reason: 'College convocation', when: '3 days ago', facts: [['Balance after', 'None left'], ['Others out', 'No one']], flag: 'No casual leave left. This day would be unpaid.' },
    { id: 'ap4', kind: 'Attendance', who: 'Aditya Rao', what: 'Missed punch-out · Wed 23 Sep', n: 'Says 19:05', reason: 'Badge reader at the exit was down', when: 'Yesterday', facts: [['Punch-in', '09:31 · Face'], ['Hours if approved', '9h 34m']], flag: '' },
    { id: 'ap5', kind: 'Requests', who: 'Divya Pillai', what: 'Work from home · Wed 30 Sep', n: '1 day', reason: 'Plumber visit at home', when: '2 hr ago', facts: [['WFH this month', '2 of 6'], ['Team in office', '6 of 8']], flag: '' },
    { id: 'ap6', kind: 'Requests', who: 'Rohit Verma', what: 'Shift change · General → Early', n: 'From Mon 5 Oct', reason: 'Covering the EU release window', when: 'Yesterday', facts: [['New timing', '07:00 – 16:00'], ['Early shift now', 'No one in your team']], flag: '' },
    { id: 'ap7', kind: 'Expenses', who: 'Priya Sharma', what: 'Client visit travel · 3 receipts', n: '₹4,860', reason: 'Cab and meals for the Acme visit', when: '4 days ago', facts: [['Policy check', 'Within limits'], ['Receipts', 'All attached']], flag: '' }
  ];
  const teamMore = {
    reviews: [['Kavya Menon', 'Self-review in', 'ok'], ['Rohit Verma', 'Self-review in', 'ok'], ['Priya Sharma', 'Due Wed, 30 Sep', 'wait'], ['Aditya Rao', 'Due Wed, 30 Sep', 'wait']],
    probation: ['Aditya Rao', 'SDE II', 'Mon, 5 Oct', 'In 10 days'],
    out: [['Arjun Nair', 'Today', 'Sick leave'], ['Priya Sharma', 'Mon 28 – Tue 29 Sep', 'Waiting for you'], ['Aditya Bose', 'Thu 1 Oct', 'Waiting for you'], ['Kavya Menon', 'Mon 5 – Fri 9 Oct', 'Waiting for you']],
    celebrate: [['Kavya Menon', 'Birthday · tomorrow'], ['Rohit Verma', '3 years · Mon 12 Oct']]
  };

  const notices = [['Payroll locks on Mon, 28 Sep', 'Fix any missed punches before then so your salary is right.'], ['Diwali party · Fri, 6 Nov', 'At the Bengaluru HQ terrace from 6 PM. RSVP by 30 Oct.']];

  window.UTEmp = { me, month, timesheet, wfh, shifts, leave, pay, docs, grow, team, week, approvals, teamMore, notices };
})();
