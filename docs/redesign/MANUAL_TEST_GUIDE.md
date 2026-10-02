# Testing guide — UnifiedTree HRMS

**For:** the two people testing the HRMS page by page.
**Read sections 1 and 2 first.** They will stop you reporting things we already know, and stop you
breaking something that is hard to undo.

---

## 1. What happened

The whole HRMS was redesigned and went out in three steps. **All of it is now live.**

| | What changed |
|---|---|
| **Release 1** (30 Sep) | A new look on every page. Dark mode. A new left side bar and More menu. A redesigned dashboard. Where you land after signing in now depends on your role. |
| **Release 1.1** (2 Oct) | The old font came back. Each module's pages are now **tabs along the top** instead of a panel on the left. Greetings use your full name. "Upcoming milestones" became "Upcoming events". |
| **Release 2** (2 Oct) | Everything else rebuilt: Leave, Payroll, Attendance, Expenses, Performance, Learning, Reports, Letters, Profile and more. Plus new features. This one also changed the backend and the database. |

If you used the old system, **expect everything to look different.** That is intended, not a bug.

---

## 2. Before you start

### Sign in as different people
This matters more than anything else. Most bugs in a system like this are **"the wrong person can see
this"** or **"the right person can't"**. Test each page as:

- **Owner / Admin** — sees everything
- **HR manager** — sees everyone's data, but is not an admin
- **Department manager** — should see **only their own team**
- **Finance** — payroll and money, but not HR data
- **Employee** — only their own things

**If a page shows you someone else's data that you should not see, stop and report it straight away.**
That is the most serious kind of bug. The same goes for a button that appears when it should not.

### Please don't do these
Even though this is our own data, these are hard to undo:
- Don't **process, lock or pay a payroll run**. Looking is fine; pressing the buttons is not.
- Don't **disburse an advance** or **settle a full & final**.
- Don't **send a letter** to a real address, and don't use "Send on a date".
- Don't **Share a live review cycle** (it reveals feedback to employees).
- Don't **delete** real employees, companies, branches, departments or roles.
- Don't change **Danger zone** settings.

Want to test one of these? Ask first and we will set up a safe test company.

### How to report a problem
One row per problem, in the shared list:
1. **Who you were signed in as** (role and email)
2. **The page** (copy the address from the browser)
3. **What you did**, step by step
4. **What you expected**, and **what actually happened**
5. A **screenshot**. Say if you were on a phone or a narrow window.

---

## 3. Test these hard — finished and rebuilt

Dashboard · Home · My team · Attendance (daily tracking, analytics, shifts & overtime, muster roll,
manual entry) · Leave · Payroll (dashboard, runs, salary structures, settings, bank) · My payslips and
My salary · Expenses · Production-linked incentive · Advances & loans · Full & final · Performance ·
Learning · Resignation & exit · Reports and the six report pages · Workforce analytics · Letters ·
Documents · My documents and My assets · Employee profile and My profile · Org chart · Search and notifications

### New behaviour worth extra attention

1. **Top tabs.** Each module's pages run along the top. Check every tab opens the right page, the current
   one is highlighted, and they scroll sideways when there are many.
2. **Search (top of the screen).** Finds people, leave, payslips, documents, pages, holidays, and requests
   (work from home, shift changes, attendance fixes, advances, overtime).
   **Test this hard as a department manager and as an employee**: you must only find what you are allowed to see.
3. **Notifications (the bell).** Each one should open the right page.
4. **Web check-in with a face scan.** New, and **on for every company**. Needs a camera, and you must be at
   the office location unless you have approved work-from-home.
5. **Punch for a team member.** A manager punches someone in using that person's face.
6. **Overtime.** Minimum 1 hour, and it is a threshold: once you pass it, *all* the extra time counts
   (1 h 20 m counts as 1 h 20 m). Employees can request overtime for any day.
7. **Undo on approvals.** After approving or rejecting, there is a short window to undo. Check the undo
   really reverses it.
8. **Profile → Access tab** (only for people who manage users): sign-in status, roles, and extra or
   removed permissions.
9. **Letters.** Preview before saving, request a signature, and schedule sending for a date.
10. **Reports.** Daily and weekday report emails, and you can choose the hour. Emails now also attach a CSV.
11. **Org chart.** Everyone can open it. An employee should see their own line upwards and everyone below
    them; someone with full people access sees the whole company.
12. **Dark mode** (More menu). Go through the finished pages again with it on. This is where unreadable
    text and stray white boxes hide, because most people never switch it on.

---

## 4. A suggested order

**Pass 1 — does every page open? (about 2 hours)**
Sign in as each role and open all 91 pages from the side bar and top tabs. Note anything that shows an
error, stays empty forever, says "no access" when it should not, or is missing from the menu when it should be there.

**Pass 2 — every button on the finished pages (the bulk of the work)**
For each page:
- Click every button. Open every pop-up and close it three ways: Cancel, the X, and the Escape key.
- Submit a form empty, then with wrong values. The message should be clear and in plain English.
- Use the page's filters and search. Change a date and check the page follows it.
- Sort and page through any table.
- Check the numbers at the top match the list below them.

**Pass 3 — the edges**
- **Phone size:** narrow the browser to about 390 px, or use a phone. Nothing cut off, no sideways scrolling.
- **Dark mode:** all the finished pages again.
- **Reload** a page that has tabs and filters. It should come back to the same place.
- **The back button**, after moving between tabs.
- **Two people at once:** one approves something, the other refreshes and should see it.

---

## 5. Is the data right? (a few checks worth doing)

The screens are new, but the data behind them should be unchanged. Worth confirming:

- **Numbers agree with lists.** If a card says "16 not marked", the list below should have 16 rows.
- **A change sticks.** Edit something, reload the page, and check it is still there. Then check it shows
  the same on a related page (for example: approve leave, then look at the team calendar and the balance).
- **Totals add up.** On attendance, the percentages across a day should come to about 100%. On payroll,
  the run total should match the sum of the payslips.
- **Dates are right.** We are in India time. A day's data should be that day, not shifted.
- **Nothing was lost in the upgrade.** Open a few older records (an old leave request, an old payslip, an
  old employee) and check they still read correctly.
- **One company's data never shows in another.** If you have access to more than one company, switch and
  confirm the lists change completely.

---

## 6. Report only real breakage here — not redesigned yet

These work but still look older. That is expected.
**Report:** crashes, wrong data, access problems. **Don't report:** old-fashioned styling.

Hiring · Onboarding · Compliance · Rules & policies · HR integrations · Notification templates

---

## 7. Ignore completely

- **Workspace settings:** Billing & plan, Branding, Danger zone, Security, Document types, Notification
  settings. This whole area is **paused** pending a client decision and will change.
- **Users & access** and **Roles & permissions**: look if you like, but don't change anyone's roles.
- **The sign-in page.** A new design is coming.
- **The phone app.** It does not yet know about several new things in this release. Known, being handled.

---

## 8. Already known — please don't report

- Payslip "on hold", tax (TDS) calculation and overtime **pay** are **not built**.
- Report emails are bigger now, because a CSV is attached.
- Workforce analytics shows one view at a time; attrition defaults to this financial year.
- Company KPIs cannot be deleted; they are retired by changing their status.
- If the incentives (PLI) page looks empty, check the month — it shows the current month only.
- Attendance and shift pages: the alert counts that used to sit on the section bar are gone. The counts on
  the pills inside each page are still there.

---

## 9. Still waiting on the client — note it, don't file it

- Whether the **Admin** role should get three new permissions (message your team, probation decisions,
  timesheet approval). Owner and Super admin have them; Admin does not.
- Whether **web check-in** stays on for every company.
- In **Resignation & exit**: whether "Mark exited" should stay one click when the exit type is already
  recorded, whether "Exited this year" should count terminations, and whether the exit lists need a search box.
