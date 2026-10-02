# Manual testing guide — UnifiedTree HRMS redesign

**Who this is for:** the two testers going through the HRMS screen by screen, button by button.
**What it covers:** what is finished and worth testing hard, what is half-built, and what to leave alone.

Please read section 1 and section 2 before you start. They will save you from reporting things we already know,
and from breaking something that is hard to put back.

---

## 1. Before you start

### Where to test
Test on the **live site** only after the team tells you Release 2 is deployed. Until then, test on the
preview link the team gives you. Ask if you are unsure which one you are on.

### Who to sign in as
Test **every page as more than one person**. Most bugs in this system are "the wrong person can see this" or
"the right person can't". Use the logins the team gives you for:

| Role | Why it matters |
|---|---|
| Owner / Admin | Sees everything. Good for finding broken pages. |
| HR manager | Sees everyone's data but is not an admin. |
| Department manager | Sees **only their own team**. The most common source of bugs. |
| Finance | Payroll and money, but not HR data. |
| Employee | Sees only their own things. |

### The golden rule
**If a page shows you someone else's data that you should not see, stop and report it immediately.**
That is the most serious kind of bug here. Same for a button that is there but should not be.

### What NOT to do on the live site
These do real, hard-to-undo things:
- **Do not process, lock or pay a payroll run.** Looking is fine. Pressing the buttons is not.
- **Do not disburse an advance or settle a full-and-final.**
- **Do not send a letter to a real employee**, and do not use "Send on a date".
- **Do not Share a live review cycle** (it reveals feedback to employees).
- **Do not delete real employees, companies, branches, departments or roles.**
- **Do not change Danger zone settings.**
- If you want to test one of these, say so and the team will give you a safe test company.

### How to report
For each problem, write:
1. **Who you were signed in as** (role and email)
2. **The page** (copy the address from the browser)
3. **What you did**, step by step
4. **What you expected** and **what happened**
5. A **screenshot**, and the window size if it was a phone or a small window

Please file them in one shared list, one row per problem.

---

## 2. What is finished, and what is not

### ✅ Finished and worth testing hard

These were rebuilt on the new design and have passed our automated tests. Push on them.

| Area | Where |
|---|---|
| **Left side bar, top tabs, More menu, search, notifications** | Everywhere |
| **Dashboard** | Dashboard |
| **Home** (employee and manager) | Home |
| **My team** | My team: Team today, Team schedule, Approvals |
| **Attendance** | Daily tracking, Attendance analytics, Shifts & overtime, Muster roll, Manual entry |
| **Leave** | Leave: approvals, apply, calendar, holidays, all balances |
| **Payroll** | Payroll dashboard, Processing & payslips, Salary structure, Payroll settings, Bank disbursement |
| **My pay** | My payslips, My salary |
| **Expenses, PLI, Advances, Full & final** | Expense center, Production-linked incentive, Advances & loans, Full & final |
| **Performance and Learning** | Performance, Learning & skills |
| **Resignation & exit** | Resignation & exit |
| **Reports** | Reports center, the six reports, Workforce analytics |
| **Letters and documents** | Letters, Documents, Documents to review, My letters, My documents, My assets |
| **Employee profile** | Workforce directory → a person; and My profile |
| **Org chart** | Org chart, and Organization setup → Org chart |

### ⚠️ Half-built — report only what is clearly broken

These work but were **not** part of the redesign. They look older and that is expected.
Report crashes, wrong data or access problems. **Do not** report that they look old-fashioned.

- **Hiring** and **Onboarding** (waiting on a client discussion)
- **Rules & policies** screens (waiting on reference designs)
- **Compliance**
- **HR integrations** and **Notification templates**

### 🚫 Leave alone — do not test, do not report

- **Workspace settings → Billing & plan, Branding, Danger zone, Security, Document types, Notification settings.**
  The whole workspace and company structure is **paused** pending a client decision. It will change.
- **Users & access and Roles & permissions:** you may *look*, but do not change anyone's roles on the live site.
- **The sign-in page.** A new design is coming.
- **The phone app.** It does not yet know about several new things in this release; that is known and being handled.

---

## 3. What changed, release by release

The redesign went out in stages. Everything below is new since the old HRMS, so all of it is worth testing.
If you have used the old system, expect **everything to look different**; that is the point.

### Release 1 (live since 30 Sep) — the look and the frame around every page
- **A whole new look:** new colours, new cards, tables, pop-ups, menus and form fields, on every page.
- **Dark mode**, switched on from the **More** menu. Every page should work in both.
- **A new left side bar:** items grouped, it widens when you hover, you can pin it open, and anything that
  does not fit moves into **More**.
- **A new More menu:** your profile, My space, settings, light/dark, help and sign out.
- **Where you land after signing in depends on your role:** admins, HR and finance get the Dashboard;
  managers and employees get Home.
- **A redesigned dashboard:** greeting, the number cards, quick actions, "needs your action", attendance,
  upcoming, people, hiring and payroll.

### Release 1.1 (live since 2 Oct) — the client's first round of changes
- **The font went back** to the previous one.
- **A module's pages are now tabs along the top.** The panel that used to list them on the left is gone.
  A page's own sub-sections now sit inside the page.
- **The dashboard is about 10% tighter**, same content and order.
- **Greetings use the full name**, not just the first name.
- **"Upcoming milestones" is now "Upcoming events"**, and it now also shows holidays and company notices.

### Release 2 (the one you are testing now) — the rest of the HRMS
This is the big one. Every area in the "finished" list in section 2 was rebuilt here, and this is the first
release that changes the backend as well as the screens. Section 3.1 below lists the parts most worth
a second look.

## 3.1 Look twice at these

These are new behaviour, not just a new look. They are the most likely place to find something.

1. **The side bar and the top tabs** (Releases 1 and 1.1). Check that every tab opens the right page, that the
   one you are on is highlighted, that the tabs scroll sideways when there are many, and that the side bar's
   hover, pin and More overflow all behave.
2. **Search (the box at the top).** It now finds people, leave, payslips, documents, pages, holidays, and
   requests (work from home, shift changes, attendance fixes, advances, overtime).
   **Test this hard as a department manager and as an employee:** you must only find things you are allowed to see.
3. **Notifications (the bell).** Each one should open the right page.
4. **Web check-in with a face scan.** New. It is **on for every company**. Needs a camera, and you must be
   inside the office location unless you have approved work-from-home.
5. **Punch for a team member.** A manager can punch someone in using that person's face.
6. **Overtime.** The minimum is 1 hour by default, and it is a threshold: once passed, all the extra time counts.
   Employees can request overtime for any day.
7. **Undo on approvals.** After approving or rejecting, you get a short window to undo it. Check the undo
   actually reverses it.
8. **The employee profile has a new Access tab** (only for people who manage users): sign-in status, roles,
   and extra or removed permissions.
9. **Letters:** you can preview a letter before saving, ask for a signature, and schedule sending for a date.
10. **Reports:** daily and weekday report emails, and you can choose the hour. Report emails now also attach a CSV.
11. **Org chart:** everyone can see it. An employee should see their own line upwards and everyone below them;
    someone with full people access sees the whole company.
12. **"Upcoming milestones" is now "Upcoming events"** and includes holidays and company notices.
13. **Dark mode** (Release 1). Go through every finished page with it on. This is where unreadable text and
    stray white boxes hide, and it is easy to miss because most people never switch it on.
14. **Where each role lands after signing in** (Release 1): admins, HR and finance on the Dashboard;
    managers and employees on Home.

---

## 4. A suggested order

Three passes. Finish a pass before moving on.

**Pass 1 — every page opens (about 2 hours).**
Sign in as each role and open all 91 pages from the side bar and the top tabs. Note anything that: shows an
error, stays empty forever, says "no access" when it should not, or is missing from the menu when it should be there.

**Pass 2 — every button on the finished pages (the bulk of the work).**
Page by page, in the finished list. For each one:
- Click every button, open every pop-up, close it with Cancel, with the X, and with the Escape key.
- Submit a form with nothing filled in, then with wrong values. The message should be clear and in plain English.
- Use the filters and search on the page. Change a date and check the page follows it.
- Sort and page through any table.
- Check that the numbers at the top match the list below them.

**Pass 3 — the edges.**
- **Phone size:** make the browser window narrow (about 390 px) or use a phone. Nothing should be cut off, and
  there should be no sideways scrolling.
- **Dark mode:** switch it on in the More menu and go through the finished pages again. Look for unreadable
  text and white boxes that should be dark.
- **Reloading:** on a page with tabs and filters, reload. It should come back to the same place.
- **The back button**, after moving between tabs.
- **Two people at once:** have one person approve something and check the other sees it after a refresh.

---

## 5. Things we already know — please don't report these

- Hiring and onboarding screens look older. Known, on purpose.
- Workspace settings pages look older. Paused, see section 2.
- The sign-in page is unchanged. A new one is coming.
- The phone app does not show the new notification types yet.
- Report emails are larger now, because a CSV is attached.
- Workforce analytics shows one view at a time, and attrition defaults to this financial year.
- Payslip "on hold", a tax (TDS) engine, and overtime pay are **not built**.
- Company KPIs cannot be deleted; they are retired by changing their status.

---

## 6. Questions the client still has to answer

If you hit these, note them but do not treat them as bugs:
- Whether the Admin role should get three new permissions (message your team, probation decisions, timesheet approval).
- Whether web check-in stays on for every company.
- In Resignation & exit: whether "Mark exited" should stay one click, whether "Exited this year" should count
  terminations, and whether the exit lists need a search box.
