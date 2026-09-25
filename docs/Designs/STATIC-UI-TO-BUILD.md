# Redesign: what's static, what needs building

This file tracks the Claude Design redesign (`docs/Designs/UnifiedTree HRMS Prototype.html`, and the Master export for §6) as it's built into the app. Every screen matches the design exactly. This file lists the parts that aren't fully backed by real data yet, and every place the build differs from the prototype (with the reason). Nothing from the design was removed.

How the code is laid out:
- `apps/platform/scripts/design-build.mjs` regenerates the markup of every design component from the export. Run it from `apps/platform`: `node scripts/design-build.mjs [Component …]`.
- The generated markup is `src/design/dc/*.view.tsx` (don't edit it by hand). The logic sits next to it in `src/design/dc/<Component>.tsx`, and real data is wired in containers under `src/modules/hrms/…`.
- Reference screenshots of the prototype come from `node e2e/recovery/capture-prototype.mjs "<export.html>" <outDir>`, and screenshots of the app from `node e2e/recovery/capture-app.mjs <outDir> [--full] [--mobile] <route…>`.

Status key: **Needs backend** = shown, but the data or action isn't available yet · **Partial** = works, with a stated limit · **Kept** = existing app behaviour that the design didn't cover · **Not shipped** = only a prototype aid.

---

## 1. App shell (sidebar, top bar, tabs): done

| Item | Status | Detail |
|---|---|---|
| Icon rail, green top bar, section tabs, mobile bar and drawer | Done | Exact styles from the design. Role-based menus unchanged. |
| Search field | Done | Opens the ⌘K search palette, rebuilt 25 Sep (people, pages and tabs, actions, recent; "/" path navigation). See §11.18. |
| Notifications bell | Kept | The design has no notifications panel ("not designed yet"). The existing panel is kept, and the amber dot shows only when something is unread. |
| Profile button | Kept | The design goes straight to `/profile`. The app keeps its menu (My Profile, My Apps, Settings, **Sign out**). There's no other way to sign out. |
| Settings (gear) | Done | Same pattern as the design: the rail stays, the gear lights up, and the settings pages become tabs. The app lists all 10 real settings pages (the design showed 5). |
| Route tooltips ("→ /hrms/…") and the bottom-right "Prototype" pill | Not shipped | Navigation aids for the prototype only. Human-readable tooltips are kept. |
| Leaves added after the design (e.g. "Docs to Review" under Hiring) | Kept | Still in the menu. |
| Geofencing (`/hrms/attendance/geofencing`) | Done (retired 25 Sep) | Decision D3: punch zones live on branches. The route redirects to Companies & Branches; it's gone from the menu and search. See §11.18. |

## 2. Company Admin Dashboard (`/dashboard`): done

Checked live: `e2e/recovery/live-design-dashboard.mjs`, 12/12 (calendar, past-date view, publish and archive a notice, projects panel, tile drill-down, no page errors, no failed API calls).

| Item | Status | Detail |
|---|---|---|
| All tiles, charts, cards and lists | Done | Real data from the existing endpoints. Each card has its own loading, empty and error state. |
| Greeting | Done | The prototype always said "Good morning". It now follows the time of day (IST). |
| Chart axes | Done | The prototype had fixed axes (0–120 people, ₹42L–₹50L). They now scale to the real numbers. |
| Projects & Productivity card | Kept | The design shows a summary card. **Manage projects →** opens the existing project and task manager in a side panel, because `/projects` is still a placeholder and this is the only place to change task status. |
| Archiving a notice | Kept | Asks for confirmation first, as the old card did. The prototype archived immediately. |
| Activity feed: record name ("… for **Rahul Verma**") | Done | `/v1/audit/events` now returns `resourceName` and `resourcePath` (employee, leave request, expense claim, payroll run, department, document, policy, letter run, report email…). The row names the record and opens its page; records without a page open Audit Logs. |
| Top performers: department line | Done | `/v1/admin/dashboard/performers` returns `department`; the line reads "Engineering · 3 completed reviews". |
| Dept Distribution: click a bar to filter the directory | Done | Opens `/hrms/employees?departmentId=<id>`; the "No department" bar opens `departmentId=none` (people without one). |
| Milestones "View all →" (birthdays, anniversaries, retirements) | Done | Opens `/hrms/employees?filter=birthday` (or `anniversary`, `retirement`). The directory has a Milestone filter with the card's windows (14 days, 31 days, 6 months); the people come from `/v1/hrms/employees?milestone=…`, which uses the card's own rules. |
| Milestones → Retirements | Done (w1e) | Reads `GET /v1/hrms/retirements/due` for the company: people reaching the company's retirement age (HR Configuration) in the next 6 months. Roles without `hrms.employee.read` get the same rule through `/v1/hrms/milestones`. |
| Export headcount | Done (w1e) | Downloads `headcount-<company>-<date>.xlsx` for the dashboard's company and selected date (`GET /v1/reports/headcount/workbook`, `hrms.report.headcount`). **Summary** sheet: company, as-of date, fiscal year, totals (total, active, probation, on notice, suspended, joined/left this month and this fiscal year) and breakdowns by department, branch, designation and employment type, plus gender with `hrms.report.diversity`. **Employees** sheet (only with `hrms.employee.read`): code, name, department, designation, branch, employment type, status, joining date, manager, work email, probation end, notice last day. Names only, no ids. Past dates are worked out from joining, confirmation, probation, notice and exit dates. Live test: `e2e/recovery/live-w1e.mjs`. |
| Payroll chart: click a month | Done | Opens that month's run (`/hrms/payroll/runs/{id}`, w2i) when there is one, else `/hrms/payroll/runs?month=YYYY-MM`; the runs page has a Month filter next to Year and opens on that month (w2h). |
| Hiring stage rows → `/hrms/hiring?tab=candidates&stage=…` | Done | The link opens the Pipeline board on **All roles** with only that stage's column, which matches the tile's company-wide count. The board has a Stage filter (All stages or one), kept in `?stage=`. (w2a, 25 Sep) |
| Company notices | Done | 5 per page, as in the design, with Newer / Older buttons beside the count when there are more. Archiving the last notice on a page steps back a page. |
| Date calendar colours | Partial | The trend API caps at 31 days, so only the last month is coloured. Early departures for past days show 0 (the trend API doesn't return them). Today's figures are exact. |
| Today's Absence / Not Marked, donut, "exceptions" | Changed | Same one-bucket-per-person numbers as Attendance & Time (`attendance/attendanceBuckets.ts`). Today, someone with no punch and no leave is **Not Marked**, and Absence stays 0 until the day is over. The donut and the exceptions count no longer count them twice (the API's "not marked" also contains the absent and people on leave). |
| Seats tile | Partial | Shown only to billing admins (Owner, Super Admin, Company Admin), and once the seats data has loaded. |
| Sections the viewer has no permission for | Done (25 Sep) | Hidden, as the design intends: each section and card shows only when the viewer holds the permission its endpoint checks. See §11.18. |
| Chart colours | Decision | The prototype's default "tones" palette (multi-colour) is used. The prototype also has an "emerald only" option, which is one switch (`chartPalette="emerald"`) if you prefer it. |

## 3. Companies & Branches (`/hrms/companies`): done

Checked live: `e2e/recovery/live-design-companies.mjs`, 10/10 (create a branch with a geofence, edit it and make it HQ, archive it, edit and restore the company, save the employee-ID format, no page errors, no failed API calls).

| Item | Status | Detail |
|---|---|---|
| Company picker, company card, statutory info, next employee ID | Done | Real company data plus the employee-ID format from HR configuration. |
| Add / edit company, save ID format | Done | Existing company and HR-configuration endpoints. Edits send every field as typed, so clearing a field (e.g. GSTIN) now saves the clear. |
| Branch cards/table, search and status/city filters | Done | Real branches. |
| Create / edit branch (4-step drawer), map pin, geofence | Done | Edit uses the existing `PUT /v1/hrms/branches/{id}` endpoint (it had no web hook before). The geofence saves through `PUT /v1/hrms/branches/{id}/geofence`. |
| Mark as headquarters | Done | One save: the server switches the previous headquarters off in the same transaction (w1e, `BranchService`), and a partial unique index (V143_14) makes a second active headquarters impossible. Archiving a branch clears its flag. |
| Archive company / branch | Done | Confirmation dialog as designed. Archive is soft (employees keep their assignment). |
| Company description ("Product engineering and IT services.") | Needs backend | Companies have no description field. The card shows the design's own fallback, "No description yet." |
| Geofence without `org.geofence.write` | Partial | The branch still saves; the attendance area stays unchanged and the user is told why. |
| "Inactive" status filter | Done (w1e) | Lists archived branches (`GET /v1/hrms/branches?includeArchived=true`); their Archive button becomes **Restore**. "All statuses" keeps showing active branches, as archiving promises. |
| Employees links (company and branch) | Done | The Workforce Directory now opens pre-filtered from `?companyId=`, `?branchId=` and `?departmentId=` links. |
| Organization Setup's Companies / Branches tabs (`/hrms/organization`) | Kept | Still there, untouched. This page and those tabs manage the same records. |

## 4. Attendance & Time (`/hrms/att-analytics`, `/hrms/attendance`, `/hrms/shifts`): done

One designed page serves all three routes. Its own section bar (Analytics · Daily Tracking · Shifts & Overtime) replaces the shell's sub-tabs on these routes. Employees see only Daily Tracking (My Attendance, Regularization) and Shifts (My Shift). Container: `src/modules/hrms/attendance/AttendanceContainer.tsx`.

Checked live: `e2e/recovery/live-design-attendance.mjs`, 26/26. As HR it checks the section bar and tabs, that tiles match the table, the status filter, "Fix this day", that the who's-where breakdown adds up, the report link, and adding, editing and deleting a shift, plus the overtime "note required" check. As an employee it checks their tabs and sends a fix request, which HR then rejects. It also checks for no page errors and no failed API calls. Nothing irreversible is approved.

The w2f extras (overtime details, decided shift requests, shift notes and history, roster since, face device, per-day totals, weekly offs; migration `V143_25__attendance_extras.sql`) have an API-level live test: `e2e/recovery/live-w2f.mjs` (every new or changed endpoint, the DB effects, 403s for refused roles, and cleanup).

| Item | Status | Detail |
|---|---|---|
| Daily Logs | Done | The real roster for any past day (date picker), tiles, filters, search, person drawer, **Open full profile** and **View history** (`/hrms/employees/{id}?tab=attendance`). The shift reads "General · 9:00 AM–5:00 PM" from the company's shifts. |
| Regularization | Done | Team requests approve or reject with a note, plus "My requests" and **New request**. The fix times are sent as IST, as the page labels them. |
| My Attendance | Done | Monthly stats and the day grid from `/attendance/history` (the person's own week-offs, holidays and leave). |
| Overview & Calendar | Done | Today comes from the live roster. The month comes from the trend API, plus how people checked in, late marks and the monthly summary report. |
| Shift Schedules | Done | Add, edit and delete use the shift policies (`/v1/shifts`). Flexible and rotational shifts keep their type on edit. Night, or any shift past midnight, is saved as NIGHT. |
| Roster | Done | Today's schedule. **Assign / Change shift** uses the existing effective-date assignment. |
| Overtime | Done | "Waiting for you" (this month and last) and "This month". Approving records the decision only: **recorded, not paid**. Rejecting needs a note (API rule), and the page asks for one before sending. |
| Shift Requests / My Shift | Done | Approve or reject pending requests. Employees see their shift and their own requests and can ask for a change. |
| Counts (tiles, donut, calendar) | Changed | One bucket per person, so the numbers add up to the roster. The API's own counts overlap: its "not marked" includes people on leave and the absent. Today, anyone with no punch is **Not marked yet**. **Absent** is used only for finished days. |
| "Fix this day" (HR, Daily Logs drawer) | Changed | Opens **Manual entry** for that person and date. A fix request is always raised for the signed-in person, so HR can't raise one for someone else. |
| Face match wording | Changed | The API gives a band (High / Medium / Low), never a percentage. The card says "partly sure", "Low match" and "High needed", and "Medium- and low-confidence punches need a person to check" replaces "under 85%" (w1a: Medium now needs a look too). The backend's default match cut-off is 82% (configurable). |
| Late tile "After the 15-min grace time" | Changed | Uses the real grace when every shift shares one. Otherwise it reads "After each shift's grace time". |
| Calendar Sunday text "Only a few on-call people worked" | Changed | Shows the real count ("N people still checked in") or just "Saturday is a weekly off." (the day's own name). |
| "Download report" / "Open the full report" | Changed | Open the Attendance Summary report for this month (`?company=&from=&to=`, which is what that page reads). The CSV download is on that page. |
| On-leave days in My Attendance | Changed | Approved leave is its own colour. The design's sample month had none, so the legend lists it only when a leave day exists. |
| Phone layout | Changed | The page column is capped at the screen width, so the section bar and tabs scroll sideways as intended instead of widening the page. |
| Face check: **Yes, it's …** / **Not them** | Done (w1a, V143.10) | `POST /v1/attendance/review/face-events/{id}/decision` records who, when, the decision and a note (`attendance.face_event_reviews`). "Not them" asks why, rejects the punch and the day is worked out again (a rejected punch-in: Absent, or Not marked today; a rejected punch-out: only the check-out stops counting), written to the record for payroll, audited and the employee is told. Medium and Low matches land in "Needs a look" (last 7 days) until someone checks them. Needs `attendance.status.override`; managers only for their team. |
| Face tab "Kiosk" column | Done (w2f) | Face events carry the phone or kiosk (`device` on `/v1/attendance/face/admin/events` and on the review list `/v1/attendance/review/face-events`, which the tab reads): what the app sends as `deviceFingerprint` with the face check, else the `deviceId` of the punch it cleared (put on the check at check-in; worked out for older events). Events with neither say "Not recorded". |
| Face tab names | Done (w1a) | `GET /v1/attendance/review/face-events` returns the name, code and department with each punch (and only the caller's team for managers). |
| **Proof (optional)** file on "Ask for a fix" | Done (w1a) | Uploads when chosen (`POST /v1/attendance/corrections/attachments`: PDF / JPG / PNG by magic bytes, up to 5 MB, private document bucket), saved as `attachmentUrl`. The approver's card shows "View attachment · file name", which opens a short-lived signed link (`GET /v1/attendance/corrections/{id}/attachment`, requester or their approver only). A request can only point at the requester's own proof. Without document storage the upload says so. |
| Attendance review (Daily Tracking → **Review**) | Done (w1a, V143.10) | New tab for `attendance.status.review` (managers: their team): late past the allowance, half days, absences, early leaving, no check-out, check-ins outside the zone, rejected face punches and unsure face punches from the last 7 days, as approval-style cards. **Excuse** or **Change status** (Present / Late / Half day / Absent / remove the manual status) with a required reason. Every change is audited (`attendance.day_status_reviews`: who, when, from → to, reason, plus an audit event), shown in the person's record (Attendance → Status changes) and notified to them. Daily Logs' person drawer has **Change status** too. |
| Statuses on every screen | Done (w1a) | Roster / Daily Logs, muster roll, trend and calendar, dashboard and My team, weekly summary, monthly stats and history all read one effective status per person per day: the company's attendance policy (grace, start time, half-day rules, minimum hours, late allowance) plus any reviewer's change (`EffectiveDayStatusService`). Absent = no punch, no leave, not a weekly off or holiday, and the day is over. |
| Roster "Since" column | Done (w2f) | `/v1/team/schedule` returns `since` (the day the current assignment started) and `joinedOn`. People with no shift yet show "Joined 3 Sep 2026". |
| Roster shift match | Done (w2f) | Matched by `shiftPolicyId` from `/v1/team/schedule` (by name only on an older server). |
| Note field in the Change-shift drawer | Done (w2f) | Saved with the assignment (`note` on `POST /v1/shifts/employee/{id}`, column `employee_shift_assignments.note`, V143_25). It shows in the new **Shift history** table on the employee's Attendance tab (`GET /v1/shifts/employee/{id}/history`: the employee, anyone with `attendance.workforce.admin`, or their own manager). An approved shift change request leaves the employee's reason there. |
| Overtime: shift end, left at, reason | Done (w2f) | The overtime list returns the shift in force that day (name, end), the check-out time and a reason: the employee's own (sent with the check-out as `overtimeReason`, or `PUT /v1/attendance/overtime/{id}/reason` while pending; column `records.overtime_reason`, V143_25), else the reason HR gave for a manual entry, else the approved fix request's (the nightly "AUTO_CLOSED" marker is not a reason). The card's "Raised" line says which; with none it reads "None given · recorded automatically". The mobile app doesn't send `overtimeReason` yet. |
| Overtime older than last month | Partial | The design has no month picker. Pending items from this month and last are listed. |
| Shift Requests "Already decided" (HR) | Done (w2f) | `GET /v1/shifts/change-requests/decided?days=30` (same permission as the pending list; a manager gets their own team's). Each row says who approved or rejected it, when, and their note ("Closed automatically" for requests that expired). |
| Shift colour | Partial | Not stored: it's worked out from the start time, and night shifts are the moon. Picking **Night** saves the shift as NIGHT. The other colours are display only. |
| Break | Partial | Stored as working hours per day. Break = shift length minus working hours. |
| Past days' "came in" (trend, calendar) | Done (w2f) | The trend API returns `checkedIn` (each person once) and `workFromHomeOnTime`, so a person who worked from home and was late or half-day counts once, as late / half-day. With the attendance policy (w1a) the trend counts each person once from their effective status, and the same fields are filled from it. |
| Weekly off on the calendar | Done (w2f) | The trend API flags `weeklyOffDay` (nobody in scope was scheduled: the company's and each person's own week-offs). The calendar, the month chart, the working-day count and the dashboard's date calendar grey those days out instead of Sundays; days the trend doesn't cover follow the weekdays that were always off. |
| HR without the face-log permission | Partial | The Face tab shows its empty state. The design has no "no access" state for it. |
| Geofencing | Retired (25 Sep) | `/hrms/attendance/geofencing` redirects to Companies & Branches, where each branch holds its punch zone. See §1 and §11.18. |
| Old pages (`Attendance.tsx`, `AttendanceAnalytics.tsx`, `ShiftsAndOt.tsx` and their parts) | Removed | Replaced by the designed page. Manual entry, Muster roll, Geofencing and `/me/shift-change` are untouched. |

## 5. Payroll (`/hrms/payroll-dashboard`, `/hrms/salary-structure`, `/hrms/payroll/runs[/:id]`, `/hrms/payroll/settings`, `/hrms/pli`, `/hrms/advances`, `/hrms/bank-disbursement`): done

One designed page serves all eight routes, with its own section bar in place of the shell's sub-tabs. Container: `src/modules/hrms/payroll/PayrollContainer.tsx`.

Checked live: `e2e/recovery/live-design-payroll.mjs`, 29/29. Bulk revise CTC, the structure export and advances for someone else have their own API check, `e2e/recovery/live-w2e.mjs` (written 25 Sep, not run yet). The payroll check covers:
- All seven sections.
- A test run for Jun 2027 (a month with no advance recoveries due): created, processed, payslip opened, locked and reopened, then deleted from the local database.
- The register and payslip PDF downloads.
- The bank page and its profiles link.
- The salary, settings, PLI and advances drawers.
- The employee's own advances page.
- No page errors and no failed API calls.

| Item | Status | Detail |
|---|---|---|
| Payroll Dashboard | Done | Tiles, 6-month chart, this month's run and recent runs come from the runs. Pending disbursals comes from the payroll KPIs, and paid dates from the bank files. |
| Processing & Payslips | Done | All runs, the step pipeline as a filter, and **New run** (months that already have a run are shown and disabled). |
| Run page | Done | **Process**, **Re-process**, **Lock**, **Reopen** (with a reason), **Prepare bank disbursement**, **Mark as paid**. Overview, Employees and Skipped tabs, the payslip drawer with PDF download, and the payroll register (PDF). |
| Salary Structure | Done | Everyone in the directory with their current structure. **Add** or **Edit** saves a new revision. The "no salary structure" list is the current run's skipped people. |
| Payroll Settings | Done | The real settings, PT slabs for the chosen state, save, and the unsaved-changes guard. |
| PLI | Done | This month's targets. **Edit** saves the target, **Set monthly targets** writes next month's, and **Export** gives a CSV. |
| Advances & Loans | Done | Every advance, with **Approve**. The drawer has the real recovery plan plus the existing Approve / Reject / Record payout actions. **Recovery options** opens the existing tools (defer a month, close early, write off). |
| Bank Disbursement | Done | This run's upload file (planned → generated → sent → paid), **Download** (which posts it), **Confirm transfer**, and past files. |
| **Mark as paid** / **Confirm transfer** | Changed | Both ask for the bank reference (UTR). The API needs it to mark a transfer paid, and confirming also closes the run. |
| Bank files | Changed | The API makes **one** file per run from the company's default bank profile (the design showed one per bank). Reopening cancels that file first, because the API won't reopen a run that has a live file. |
| **Bank profiles** button (Bank Disbursement header) | Kept | Profiles aren't in the design but are needed to make files. The button opens the existing full page at `/hrms/bank-disbursement/setup`. |
| PLI banner | Done (w1b, 25 Sep) | Decided with the client: approved PLI awards are paid through payroll. Processing a run adds every approved, unpaid award (approved by the end of the period) as one "Performance incentive" earnings line, paid in full and outside the PF/ESI base. Locking marks the awards paid with the run id, reopening reverts them, and the separate award action ("Paid outside payroll") refuses an award a run holds, so nothing is paid twice. The banner says so; **Manage awards →** opens the awards manager, which shows each award's payroll month. |
| Advances statuses and actions | Changed | The API's statuses map to Pending approval / Approved · to pay out / Active deduction / Repaid / Closed / Rejected. **Issue advance** asks for the signed-in person, or for someone else (see below). |
| Salary drawer | Changed | A new structure uses the design's split: Basic 50%, HRA 40% of basic, ₹1,600 conveyance from ₹20,000, special allowance the rest. Editing an existing structure scales that person's own split (their saved component lines), so a custom split is never overwritten; lines that aren't pay (a fixed deduction) and the person's ESI / PT state are kept. A structure with no component lines is paid as basic and stays that way. The preview uses the real PF, ESI and PT settings. There is no ₹10,000 minimum, because that isn't a rule in the system. |
| Dashboard "Total payroll cost" | Changed | The gross of this month's run, so it matches the chart and the runs list. The KPI endpoint's figure also includes employer contributions. |
| Employees without the admin view | Kept | `/hrms/pli` and `/hrms/advances` still show their own self-service pages (My Incentives; My Advances / Request). |
| "TDS this month" tile | Needs backend | Payroll doesn't calculate TDS. The tile shows a dash and says so. |
| Statutory dues | Done (w1b) | PF, ESI, PT and LWF per month are added up from locked and paid runs (`GET /v1/payroll/statutory-dues`). PF and ESI are due on the 15th of the next month; PT and LWF say "as your state requires" unless the ledger has a date. Compliance → Statutory Filings stays the filing record: a due disappears once a filing of that type and month is recorded there. TDS and gratuity still come from the ledger. |
| Pay breakdown by component | Done (w1b) | `GET /v1/payroll/runs/{id}/component-totals` adds up every payslip line on the server, for any run size. |
| Run details "Pay date" / "Working days", activity names | Done (w1b) | Runs store the planned pay date (the processing day in the month the period ends) and working days (the company's work week minus holidays). Activity lines name who created, processed, locked and paid the run. Runs from before V143_11 show a dash for working days until they're processed again. |
| Salary Structure **Export** | Done | Downloads every current structure as an Excel workbook: code, name, company, department, designation, grade, status, effective date, annual and monthly CTC, each component's monthly amount, gross, and tax regime / PF (`GET /v1/payroll/structures/export`, `?format=csv` for CSV). Needs `payroll.structure.read`; every export is audited. |
| **Bulk revise CTC** | Done | The design's modal, plus: **Revise by** a percentage or a fixed amount a year; **Who** is everyone, a company, department, designation, grade or hand-picked people; the 1st of a month as the start; a reason. The preview lists each person's current CTC → new CTC and the increase, the totals, who is left out and why (no structure, or one that already starts later), and anything in payroll that blocks it (an earlier run still open, a locked run the date would reach, or a month between the last locked run and the date that isn't locked yet, since payroll pays every run from each person's latest structure). A company that has never locked payroll gets a warning instead for a date after this month. **Apply revision** saves a new structure per person with their own split scaled, closes the old one the day before, records the batch (`payroll.salary_revision_batches`), audits each person and notifies them. It refuses if anything changed since the preview. Permission `payroll.structure.bulk-revise` (high risk: OWNER, SUPER_ADMIN, FINANCE_LEAD); the button is hidden without it. |
| **Issue advance** for someone else | Done | With `hrms.advance.request.others` (OWNER, SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD) the Employee list has everyone active. It goes to that employee's approver and then the usual payout and recovery; who raised it is saved and shown ("Raised by" in the details, and on the employee's My advances). The employee is notified. Not for yourself (that stays your own request) or anyone who has left. |
| Advance "Loan type" | Partial | The API has no loan types, so the request's reason is shown. The first deduction is always the month after payout (API rule). |
| PLI people and "Bonus per person" | Partial | Headcount is known for employee or department targets. For others the amount is the whole pool. The pool is a target; what payroll pays are the approved awards. |
| Payroll cycle days, processing day, LWF, PF/ESI codes | Done (w1b) | Runs follow the cycle start day (1 = calendar month; on the 26th the September run covers 26 Aug – 25 Sep, and the end day follows the start day). The processing day sets the pay date. LWF is deducted in the months chosen on the LWF card (June and December by default; also December only or every month), with the employer share recorded. PF/ESI codes show on Statutory Settings. The cycle card's switch stays on (the API has no switch for it). |
| Payroll register | Partial | A PDF (the design said Excel), available for locked and paid runs. The run's Employees tab exports a CSV. |
| Old pages (`PayrollDashboard`, `PayrollRuns`, `PayrollRunDetail`, `SalaryStructureAdmin`, `SalaryOverview`, `PayrollSettings`, `Payroll.tsx`) | Removed | Replaced by the designed page. `/me/payslips`, `/me/salary`, `/hrms/payroll/components` and `/hrms/fnf` are untouched. |


**Follow-up (25 Sep): two gaps from the redesign, now fixed.**
- *Bank file with missing bank details.* The server leaves out anyone without a usable primary bank account and refuses the file (`BATCH_HAS_EXCLUDED_EMPLOYEES`). The old page listed those people. The redesigned Bank page only showed "Could not download the file". Now:
  - The file card reads "N without bank details".
  - Download and "Mark transferred" are hidden.
  - A notice names each person; each name opens their Payroll tab, where the bank account is added.
  - **Rebuild file** refreshes a draft; **Cancel this file** handles one already sent.
  - The Bank page also opens on a chosen run (`?run=`); a run's page links to its own file.
- *Payslip that can't load.* The drawer stayed blank forever. It now shows a skeleton while loading, and "Couldn’t load this payslip" with **Try again** on error.
- Checked live: `live-payroll-access.mjs` was rewritten for the redesigned pages. All 6 steps pass: reopen with a reason, exclusions named and blocked, fix and rebuild, pay, the payslip outage, and a missing run. The test now removes its run, bank file, bank profile and fixture employee afterwards.

**Payroll core (w1b, 25 Sep): the payroll items above marked "Done (w1b)".** Migration `V143_11__payroll_core.sql` (no new permissions). Pay is worked out with each employee's own weekly off (else the company's, else Sat+Sun) over the configured pay cycle; approved PLI awards, LWF in its months and fixed-amount components are part of the run. Rules are unit-tested (`PayrollCalcTest`, `PayrollEngineExtrasTest`, `PliPayrollNoDoublePayTest`); the API is checked by `e2e/recovery/live-w1b.mjs` (a Jun 2031 test run, removed afterwards).

## 6. Master data (`/hrms/master`, `/hrms/employees`, `/hrms/organization`, `/hrms/policies`, `/hrms/payroll/components`, `/hrms/master/*`): done

Design: `docs/Designs/UnifiedTree Master (offline).html`: an Overview plus 13 pages under four tabs (Workforce Directory, Organization Setup, Rules & Policies, Payroll Configuration).

How it's built. This export is a plain React prototype, not the dc format.
- `apps/platform/scripts/master-build.mjs` takes the design's own components and CSS.
  - The CSS is scoped under `.utm`, so it can't reach other pages.
  - It drops the sample data, the prototype's own rail and top bar (the app keeps its shell), and the tweaks panel.
  - It applies the patches in `scripts/master-patches.mjs`. Each patch is a find/replace with a reason, and the build fails if a target changes.
  - Output: `src/design/master/MasterDesign.tsx` and `master.css`. Don't edit these by hand.
- Real data: `src/modules/hrms/master/MasterContainer.tsx` loads the API.
  - `masterData.ts` turns API rows into the design's records.
  - `masterSync.ts` turns every edit the design makes into the matching API calls.
- A change shows at once. The page's success toast waits until the server accepts it. If the server refuses, the data goes back and a red toast gives the reason.
- Nothing that wasn't saved is ever shown as saved.

Routes:
- `/hrms/master`: the Overview.
- `/hrms/employees`: Employee Master.
- `/hrms/master/{contractors, classifications, companies, branches, departments, designations, grades, shift-rules, leave-rules, statutory}`.
- `/hrms/policies`: Policy Documents for policy admins. Employees keep their acknowledgement page here.
- `/hrms/payroll/components`: Salary Components.
- `/hrms/organization`: opens the first Organization Setup page the person can see.

Other details:
- Each page shows only when the person holds the permissions its endpoints check.
- The design's tabs replace the shell's sub-tabs on these routes.
- The old `Employees.tsx`, `OrgSetup.tsx` and `SalaryComponents.tsx` are removed. Everything they did is on the new pages.

Checked live:
- `e2e/recovery/live-design-master.mjs`, 41/41. It covers:
  - All 15 routes.
  - The employee list: search, CSV export, profile, an edit that saves, and "Full record".
  - Creating, editing and archiving a department, grade, designation, leave type, shift, policy draft, salary component, agency and employment type, all removed from the local database afterwards.
  - The statutory switch.
  - An employee keeping the policies page.
- `e2e/recovery/live-directory-export.mjs`, 10/10.
- `e2e/recovery/live-w2c.mjs` (API and database only, no browser) covers the organisation-setup work of 25 Sep (V143_22): grade pay bands and who can see them, designation grade by id and codes, the per-employee pay band, agencies (edit, end, reactivate, licence, service, sites, contract workers), department moves and branches, company TAN / incorporation / description, branch types and inactive branches, and the classification update, with a 403 for every refused role. It removes everything it creates.

| Item | Status | Detail |
|---|---|---|
| Overview, Employee Master, Companies, Branches, Departments, Designations, Shift Rules, Leave Rules, Policy Documents, Salary Components, Statutory Settings | Done | Real data and real saves. Headcounts come from the employee list, because the API's cached counts are never updated. |
| Classification Rules | Changed | Backed by **employment types**, which are what employee records link to (by code). Probation and notice show the company-wide HR configuration. PF/ESI shows "Set per employee", because it lives on each salary structure. The separate `/v1/hrms/classifications` API (list, create, update and archive, all permission-based since 25 Sep) has no screen. Built-in types can't be edited, as on the old page. |
| Contractor Master | Done (25 Sep) | Add, **Edit agency**, **Renew licence** (a year on from the current expiry; with no date on record it opens the form), **End contract**, **Reactivate** and Export all work. Service, deployment sites (active branches of the agency's company), licence number and expiry are stored. **Active workers** is counted, never typed: contract workers (employment type Contract) are linked to an agency with the **Staffing agency** field on their Employee Master record, and the count is those still working. Ending a contract keeps the agency (shown inactive) and its worker links. Editing agencies needs `hrms.contractor.write`; linking a worker needs that or `hrms.employee.write`. The list of an agency's workers is whole for those people; a department manager who can read agencies sees only the workers in their own team. "Since" stays blank: there's no engagement start date. |
| Grades & Bands | Done (25 Sep) | Grades and their pay bands (minimum and maximum annual CTC, both or neither, maximum above minimum) are saved; band bars, ranges, midpoints and overlaps show. Bands are pay data: they need the new permission **View grade pay bands** (`hrms.grade.band.read`; Owner, Super Admin, Admin, HR Manager, Finance Lead). Others see the grades with "Pay band hidden" and can't change a band. **Salary Structure** warns under the monthly gross when the CTC being saved is outside the band of the person's designation's grade; it never blocks. Deactivate was added to the grade menu, matching the old page. |
| Employee add / edit | Done | Creates with the fields the design asks for, assigns the shift, and sends the login invitation (as the old wizard did). The next employee code comes from the company's code settings. Company can't be changed on edit. The full record page (`/hrms/employees/:id`) stays and has a **Full record** button in the profile. A contract worker also gets a **Staffing agency** field (25 Sep), shown to people who can read agencies. |
| Bulk status change | Changed | "Mark as active" confirms people on probation and cancels notice for people serving it. "Mark as probation" changes active people only; people on notice are left alone. The toast counts only the people who changed. |
| Start exit | Done | A last working day of today or earlier marks the person exited; a later one starts their notice. |
| Import / Export | Done | **Import** opens the existing bulk import. **Export** downloads the rows shown, with the same columns and spreadsheet-formula guard as the server export. |
| Shift Rules | Done (25 Sep, w2d) | Name, type, times, grace, hours and overtime rate are saved, and now also the **shift code** (optional, unique among active shifts), **core hours** for flexible shifts (a check-in after core start is Late) and **weekly offs per shift** (attendance uses them for people with no weekly offs of their own). **Duplicate** opens a filled "Add shift" form without the code, because shifts can't be parked as inactive and codes are unique. Overtime copy says the rate is recorded, not paid, which is the business rule. An overnight shift is saved as a Night shift. |
| Leave Rules | Partial | Name, code, category, quota (must be more than 0), paid, carry-forward cap, **how it's credited** (upfront, monthly, quarterly), **encashable** and the **most days encashed a year** are saved and used (25 Sep, w2d): a daily job credits monthly/quarterly balances, the January job carries unused days forward up to the cap and lapses the rest, and employees ask to encash from Leave → Encash (HR approves; payroll pays it, paid as one "Leave encashment" earning by the next payroll run, outside the PF/ESI base; locking marks it paid, reopening puts it back). HR sees and runs both jobs from Leave → Year end, with the audit trail. Per-classification "Applies to" is still "Coming soon". |
| Policy Documents | Done (25 Sep, w2d) | Publish, save as draft, edit, new version (a new draft), archive and restore all work. **Remind** reminds everyone who hasn't acknowledged (not anyone reminded in the last 24 hours), **Email everyone when published** emails and notifies the roster, **Require acknowledgement** can be switched off (published for reading only) and an optional **automatic reminder** goes N days after publishing. **Discard draft** deletes the draft for good after a confirmation; deleting a published policy archives it. |
| Salary Components | Partial | Add, edit and delete (for components that aren't built-in or in use) work. Computation shows the backend's types: Fixed, % of Basic, % of Gross, Formula, Statutory. Statutory lines show the real PF/ESI rates. Done in w1b: a fixed component's **monthly amount** (paid to everyone whose structure doesn't list it, pro-rated; a deduction is taken in full unless the structure sets its own), **Show on payslip** (hidden lines print as one "Other earnings/deductions" line on payslips and the PDF) and **Deactivate** (with a warning; skipped from the next run; built-in components stay on). "Partly exempt" is still "Coming soon". The CTC card shows the split new salary structures use. |
| Statutory Settings | Partial | The switches save the payroll settings (the same ones as Payroll Settings). PT shows the configured state's real slabs. LWF is deducted by payroll in the chosen months (w1b); the card shows them and its linked components. PT and LWF registration numbers and PF admin charges aren't stored, so they show a dash. |
| Companies | Done (25 Sep) | The head office comes from the branch marked HQ. TAN (AAAA99999A), the date of incorporation (shown as "since" on the card; not in the future) and a description (shown under the legal name) are saved. |
| Branches | Done (25 Sep) | Branch types are saved: Head office, Branch, Plant, Warehouse, Office, Store, Other. "Head office" is still the company's one HQ flag, so choosing it moves the head office here. Deactivated branches show with the **Status: Include inactive** filter (kept in the URL as `?archived=1`) and can be activated again; they never appear in pickers. |
| Departments | Done (25 Sep) | Rename, code, icon, head and archive work. A department can move under another or back to the top level; the server refuses a loop (a department under itself or one of its own sub-teams). A department that has sub-teams stays top-level, because the tree shows one level of sub-teams. The **Branches** a department works in are saved (none ticked = every branch). |
| Designations | Done (25 Sep) | Codes are saved (optional, unique in the company). The grade is linked by id. The migration linked every old free-text grade that matches a grade's code (or name); the rest keep their text as a chip, and link by themselves once a grade with that code is added. |
| Loading / error / no access | Kept | The design had no such states. Each page waits for its own data and shows a loading card, an error card with **Try again**, or "You don't have access". |

**Backend gaps found while building Master** (to build; not built here). Built on 25 Sep (V143_22): grade pay bands and designation → grade by id; agency update, restore, licence, service, sites, worker links and counts; the classification update; department parent moves and `branchIds`.
- Components: done in w1b (switch off, fixed `amount`, `show_on_payslip`; duplicates were already 409).
- ~~Leave types: accrual frequency and encashable exist in the database but not in the API; there is no year-end carry-forward job~~ Done 25 Sep (w2d). `annualEntitlement` must still be more than 0.
- Shifts:
  - `GET /v1/shifts` re-creates the four default shifts on every read, so deleting one of them is undone.
  - ~~No code, core hours or weekly offs.~~ Done 25 Sep (w2d).
- ~~Policies: no delete, no reminders, no email on publish.~~ Done 25 Sep (w2d).
- Cached counts (company, branch and department `employeeCount`, designation `headcount`) are never maintained.
- Payroll: LWF, cycle days and PF/ESI establishment codes: done in w1b.

Also fixed along the way:
- The shell's section tabs are real links again, so they can be opened in a new tab.
- The HR dashboard's "View reports" permission check no longer calls hooks conditionally.
- The directory-export test's column check no longer flags "Designation".

## 7. Employee workspace (`/hrms/employees/:id`): done

Design: `docs/Designs/UnifiedTree Employee Workspace (offline).html`, component `EmployeeBodyOffline`. The design drew:
- the record header, actions menu, probation banner and the 11 tabs
- the Overview tab
- the Change shift and Edit employee drawers, and the lifecycle dialogs

Its other tabs were placeholders ("designed in part N of 4"). Per the brief, they now use the same style.

How it's built:
- `scripts/design-build.mjs` also reads this export. The view is `src/design/dc/EmployeeWorkspace.view.tsx` (generated) and the logic is `EmployeeWorkspace.tsx`.
- `src/modules/hrms/employees/EmployeeDetail.tsx` loads the record and everything the header and Overview show, and maps each action to its API.
- The other tabs are the existing sections (Personal, Job, Attendance, Payroll, Documents, Letters, Performance, Exit) inside the design's frame. Their shared pieces in `workspace/shared.tsx` now draw the design's section card, grey fact tiles and quiet empty, error and no-access states.
- The design's own side rail and top bar aren't used; the app keeps its shell, and the shell's sub-tabs are hidden on this page (the design has only "← Back").

Checked live:
- `e2e/recovery/live-design-workspace.mjs`, 22/22. A throw-away employee: header, banner, edit (saves), extend, confirm, start notice (with the required-date check), cancel notice, change shift, and every tab. Removed from the local database afterwards.
- Also: `live-employee-exit` and `live-onboarding` pass. The exit test now uses the Actions menu.

| Item | Status | Detail |
|---|---|---|
| Header, status, meta line, Back | Done | Real name, code, status (the design's tones), company · department · joined. |
| Actions menu and probation banner | Done | Confirm, extend, start notice, cancel notice, mark exited, per status. Only people who can edit employees see them. |
| Change shift | Done | The real shift list and the current (and upcoming) shift. A future date schedules the change. Gated on `attendance.workforce.admin`, the permission the endpoint checks; the old button checked a different one. |
| Edit employee (Basic / Financial) | Done | Saves only changed fields. Department, designation, branch and type are lists. The bank account and PAN aren't sent back, so "leave blank to keep" applies. **All fields…** opens the full employee form for everything else. |
| Tax regime (Edit → Financial) | Changed | It lives on each salary structure, so the field is off and says so. |
| Account card | Done | Uses the invitation status: active with last sign-in, invitation sent (with date) and **Resend**, or **Send invitation**. |
| Face enrollment | Done | Shows whether the person is enrolled; **Reset** calls the admin reset. |
| Needs attention, At a glance | Done | Same rules as before (probation within 30 days, notice, no salary structure, no shift, finished days absent this week). Tiles open their tab. |
| Onboarding record | Done | Real details, assets, policies and checklists. Rejected documents show a red pill. Only people who can edit employees can read it (the endpoint's rule). |
| Leave and Expenses tabs | Done (w1d, V143_13) | Leave: the year's balances (IST year) and the person's requests; Expenses: their claims with line items and receipts. `GET /v1/leave/employees/{id}/balances`, `…/requests`, `GET /v1/expense/employees/{id}/claims`: `hrms.leave.employee.read` / `hrms.expense.employee.read` (HR, admin; finance for claims) read anyone, department managers their team (TeamEmployeeScope), everyone else themselves; 403 renders as a no-access state. Live test: `live-w1d.mjs`. |
| Goals tile | Done | Counts only goals and KPIs still being worked on (active or at risk), from `GET /v1/performance/kpis?active=true` (w2b, 25 Sep). |
| Performance tab | Done | Goals & KPIs, every review about the person (from `GET /v1/performance/employees/{id}`, team-scoped for managers) and skills. **Open performance page** leads to the full per-employee page. The old "Review history isn't shown here yet" note is gone. |
| Onboarding "Offer accepted / Hiring manager / Recruiter / Source / Buddy" | Done | Saved on the onboarding (V143_20). When a candidate is converted, their onboarding starts if a checklist template fits (department and designation, else a general template), with the offer accepted date (IST), the requisition's hiring manager, the recruiter (whoever added the candidate) and the source filled in. HR edits them, and sets the buddy, on the checklist page. A converted hire with no onboarding yet shows the same facts read from the hiring record. (w2a, 25 Sep) |
| Old Overview section | Removed | Replaced by the design's Overview. |

**Bugs found on this page:**
- *Fixed:* The week strip called today "Absent" before the day was over; it now reads "Not marked yet". Days before a person's first punch now read "Not tracked", not "Upcoming".
- *Fixed:* The absent count on Overview no longer includes today.
- *Needs backend:* The weekly summary itself (`AttendanceService.getWeeklySummary`) still returns `ABSENT` for today with no punch. It should be neutral until the day ends.

## 8. Settings pages: the Payroll Settings pattern (`/hrms/payroll/settings`, `/hrms/settings`, `/hrms/settings/work-time`, `/profile`, `/settings/*`)

Design: `docs/Designs/UnifiedTree Payroll Settings.html` (`PaySettings.dc.html`). The live Payroll Settings page already matched it. The brief says every settings page should follow it, so the pattern is now a shared kit.

How it's built:
- `src/design/settings/SettingsKit.tsx` copies the design's parts with its exact styles:
  - page header and the sticky "On this page" list, which follows the scroll (chips on a phone)
  - a card per section with its icon, summary line and On/Off switch or "Coming soon" pill
  - fields, view-only rows, switch rows and notes
  - the view-only notice, loading skeleton, error state (with retry) and "Access restricted" state
  - the sticky "You have unsaved changes" bar ("Fix N errors to save" jumps to the first one), the dark toasts, and a warning before closing the tab with unsaved changes
- `src/modules/hrms/settings/HrConfigurationPage.tsx` is the first page built on it. It replaces two older pages:
  - Probation Settings (`/hrms/settings`)
  - Work Time Settings (`/hrms/settings/work-time`, which now opens the same page at the Work week section)
- The page has seven sections: Employee IDs, Probation, Notice & exit, Work week, Late arrival, Attendance rules and Fiscal year. With more than one company, a company picker sits at the top.

**Who sees what:**
- **Open the page:** anyone with `settings.hrconfig.write`, `settings.read` or `hrms.probation.config.read`.
- **Edit HR rules:** needs `settings.hrconfig.write`.
- **Edit probation reminders:** needs `hrms.probation.config.update`.
- **See the recent reminders list:** needs `hrms.probation.reminders.read`.
- **Everyone else:** fields show as plain values under a "View only" note.
- Reader and manager accounts are sent away by the route guard, as before.

**Checked live:**
- `e2e/recovery/live-design-hrconfig.mjs`, 25/25:
  - all seven sections and the side list render
  - the next code preview uses real data
  - an empty prefix blocks saving
  - Discard works
  - saving writes the late grace and the reminder days to the database
  - `/work-time` lands on Work week
  - no sideways scroll on a phone
  - reader and manager can't edit
  - every value is put back afterwards
- `live-dead-entrypoints.mjs` was updated for this page and the new employee workspace: 29/29.

**Payroll Settings fix:** Kerala was hard-coded as "no professional tax slabs" in the page. The database has 9 Kerala slabs. The page now shows slabs for any state that has them.

| Item | Status | Detail |
|---|---|---|
| Employee IDs (prefix, next number, preview) | Done, applied | New people get the next code. If a higher code is already in use, the server skips past it. The number's length sets the padding. |
| Probation reminders (days before, auto-extend, **Send reminders now**, recent reminders) | Done, applied | Uses `/v1/probation/config`, `/scan-now` and `/reminders`. |
| Default probation length | Done, applied (w1e) | New hires get `probation_end_date = date_of_joining + N months` (company's value, 6 when unset). 0 months: they start confirmed on the joining date (the page warns). Existing people's dates don't move. |
| Default notice period | Applied (frontend) | Pre-fills the last working day when starting an exit in Employee Master. |
| Retirement age | Done, applied (w1e) | `GET /v1/hrms/retirements/due` lists who reaches the company's age within N days (from date of birth); the dashboard's Retirements column and `/v1/hrms/milestones` use it. A daily job (09:05 IST, per tenant) alerts holders of the new `hrms.retirement.alerts` permission 90 and 30 days before, once each (`POST /v1/hrms/retirements/alerts/run` sends due ones now). |
| Work week (start day, weekly offs) | Partly applied | The leave form preview and the leave calendar use the weekly offs. **Bug (backend):** `LeaveService.isWeekend` hard-codes Saturday and Sunday, so on a 6-day or Friday–Saturday week the days deducted differ from the preview. It should read `weekend_days` for the person's company. Attendance uses each person's own `weekly_off_days`. |
| Late arrival (grace, start time without a shift, half-day limit, late allowance) | Done, applied (w1a, V143.10) | Saved per company by `PUT /v1/attendance/policy` (`attendance.policy.manage`; the grace stays in HR Configuration so the mobile Work Time screen agrees). A shift's own grace (more than 0) wins. The allowance: N late arrivals per week or month count as present, then Late / Half day / loss of pay (with a pay warning). "Deduct late minutes automatically" became "After the allowance is used" (loss of pay keeps `enable_late_auto_deduction` in step). Payroll and the attendance summary / late-marks reports read the effective status (wave-2 integration): on days with a punch the policy decides late (a late mark, or loss of pay), half day and absent; a reviewer's status wins; a status HR stored with a manual entry is kept; a day without a punch keeps payroll's old rule (paid unless marked), so a company that never set the policy is paid as before. Only effectively late days count as late marks. `UNIFIEDTREE_PAYROLL_EFFECTIVE_ATTENDANCE=false` puts payroll back on the stored status. |
| Attendance rules (geofencing on mobile, work from home, minimum hours, early leave) | Done, applied (w1a) | A check-in outside the zone is refused only when the server-wide switch AND the company's rule are on; otherwise it's accepted and flagged for review with its distance. With work from home off, `POST /v1/wfh` says so (approved days still count). Minimum hours for a full / half day and the early-leave threshold are part of the attendance policy. |
| Fiscal year | Done (w1e, decision D2) | One source: the company record (`org.companies.fiscal_year_start`). HR Configuration reads and writes it for the selected company (only when changed); the Companies API stores the same upper-case month name and refuses anything else; default April (Indian financial year). V143_14 carried over any month an admin had picked on HR Configuration. The headcount workbook's "this fiscal year" counts read it. |
| Profile (`/profile`) | Done | Photo and contact, Employment, Personal details, Approval delegation, My documents and Notifications, each as a section card. Name and phone save through the unsaved bar, with checks: the name can't be blank and the phone allows digits, spaces, + and - only. The photo uploads on its own. A `#st-<section>` link opens at that section. |
| Profile → notification switches (email, push) | Done, applied (w1c) | Every sender checks them: email off stops non-essential emails, push off stops phone push. Password reset, invitation, billing alerts and letters HR sends always go out, and the page says so. The same per-event lists as Workspace Settings sit below. |
| Workspace Settings → Profile (`/settings/profile`) | Done (w2g) | **Your account:** display name and phone save through the unsaved bar (`PUT /v1/users/me`, same checks as `/profile`). **Organisation:** workspace name, contact email and phone, address, PIN, GSTIN and PAN save to `platform.tenants` (`GET/PUT /v1/workspace/profile`). Editing needs `workspace.profile.update` (owner, super admin, admin); everyone else sees the values read-only. The server checks every field (GSTIN pattern, check character and that its middle is the PAN; 6-digit PIN) and returns a message per field; the page runs the same checks before saving. A new name updates the shell straight away. The "email us" note is gone. |
| Workspace Settings → Branding | Done (w1f, white label) | Square mark and wide logo, each uploaded, replaced or removed (with a warning). In-browser editor: crop, background removal (flood fill from the edges, tolerance slider), before/after on the rail green and on white. Server re-checks type (magic bytes), 2 MB and ≥ 128 px (`BrandingImage`); permission `settings.branding.write` (V143_15). No image → the workspace monogram. The rail, splash, browser tab ("<Page> - <Workspace>" + favicon), sign-in / reset / invite pages, payslip, salary register and letter PDFs and workspace emails now carry the workspace's name and logo, never the vendor's. Checked by `e2e/recovery/live-w1f.mjs`. |
| Workspace Settings → Security | Done (w2g) | Open to everyone signed in (it's personal). **Password:** reset email, as before. **Two-factor (TOTP):** set up with a QR code (drawn by the server as SVG) or the setup key, confirm with a code, ten recovery codes shown once (copy / download; stored as keyed hashes), new codes, turn off (needs a code). The secret is AES-GCM encrypted; a used code can't be replayed; 5 wrong codes lock the account for 15 minutes. **Sign-in:** a password sign-in for someone with two-factor stops at a code step on the web (`/v1/canonical-auth/login/mfa`, recovery codes work there too). **Active sessions:** every browser and phone signed in (device, IP, signed in, last active), sign one out or all others; a signed-out session stops at once (the access token carries the session id; `SessionRevocationFilter`), not when its token expires. **Workspace rule** (`workspace.security.manage`): two-factor optional / required for admins and HR / required for everyone, with a warning about the mobile app; people covered are walked through set-up at their next web sign-in; the list of who has it on, and "Turn off" for someone who lost their phone (signs them out, emails them; never your own; an owner's only by an owner). **Mobile app:** it can't show the code step yet, so a password sign-in that needs a code gets a clear 403 telling the person to sign in with their mobile number (text-message code). Phone-OTP and account-portal sign-ins don't ask for the code. |
| Workspace Settings → Notifications | Done (w1c) | `GET/PUT /v1/me/notification-preferences`: the signed-in person's email and push master switches and, per event, in-app / push / email choices, saved through the unsaved bar. Always-sent events are shown locked on. In-app events can also email people who opt in (off by default). Live test: `e2e/recovery/live-w1c.mjs`. |
| Workspace Settings → Billing & Plan | Done / Coming soon | The plan comes from `/v1/workspace/plan/current`. **Invoices** shows "Coming soon" and needs Razorpay's invoice API. Locally, the demo workspace has no `platform.account_workspaces` row, so this endpoint answers 403 and the page shows its load-error note. That's a gap in the test data, not a code bug. |
| Workspace Settings → Integrations | Coming soon | Slack, GitHub, Jira, Zapier, Stripe and Salesforce each show "Coming soon"; none is built. |
| Workspace Settings → Document types | Done | The existing add, edit and deactivate list, inside a section card. |
| Workspace Settings → Danger zone | Done (w2g) | **Export all data** (`workspace.data.export`: owners and super admins): a zip with a folder per module and a CSV per table (every tenant table in the business schemas), `users-and-access.csv` and a README that lists every file and what was left out (passwords, tokens, two-factor secrets, face templates, encrypted columns, full Aadhaar/passport/bank numbers). Built in the background, the requester is emailed, downloadable for 7 days, then deleted; one at a time. **Reset / Delete** (`workspace.lifecycle.manage`, and only a holder of the OWNER role can schedule): typed workspace name, a 7-day wait, cancel any time before it's carried out, and every owner and admin is emailed when it's scheduled, cancelled and when the wait ends. **The app never deletes anything:** when the wait ends the request becomes Due and the platform operator is emailed to carry it out after a backup. What reset removes and keeps is listed on the page (from `WorkspaceLifecycleService`). The mailto links are gone. |

Live API test (written, not yet run against a backend with V143_26 applied): `e2e/recovery/live-w2g.mjs` covers Profile, Security (two-factor, sessions, the workspace rule) and the Danger zone, with 403s for refused roles and database checks; it cleans up after itself. The notes below about Security's "Coming soon" sections and the danger-zone email links describe the page before w2g.

Checked live: `e2e/recovery/live-design-settings.mjs`, 38/38:
- **Profile:** the phone saves to the database and is put back afterwards; a bad phone blocks the save; Discard works; section links work.
- **Workspace Settings:** every tab renders its sections. Security has two "Coming soon" sections. Danger zone links are email links only.
- **Phone width:** no sideways scroll.
- **Reader:** their own profile works, and the danger zone stays closed.

## 9. Workforce Analytics, Reports Center and the six reports (`/hrms/workforce-analytics`, `/hrms/reports`, `/hrms/reports/*`): done

Design: `docs/Designs/UnifiedTree Workforce Analytics (offline).html`. It draws one page, Workforce Analytics, in seven states:
- ready
- loading
- no company chosen
- no results
- error
- company list not allowed
- no permission

Its demo data is labelled "for the Reports template". It includes late marks, attendance, leave balances and a list of recent exports. So the same layout is used for every report page, and for a Reports Center that has no design of its own.

How it's built:
- `scripts/design-build.mjs` reads the new export: the page is its template. The view is generated as `src/design/dc/WorkforceAnalytics.view.tsx`; the logic is hand-written in `WorkforceAnalytics.tsx`.
- The build makes three changes to the markup:
  - Each chart is wrapped in its own permission.
  - The fixed "504 Gateway Timeout" message becomes the real error.
  - The attrition chart gets room for its top axis label.
- `src/modules/hrms/analytics/WorkforceAnalytics.tsx` loads the data and does the exports.
- `src/modules/hrms/reports/ReportKit.tsx` holds the shared report parts, copied from the design: the page frame with its seven states, the Export menu, the filter bar, stat cards, chart cards, bar/line/donut charts and a table that becomes cards on a phone.
- The six report pages and the Reports Center (`ReportsIndex.tsx`) are built from it. `ReportShell.tsx` is gone.
- `src/shared/export/` holds the exports:
  - CSV
  - a real `.xlsx` writer (no library)
  - chart PNGs drawn from the same numbers
  - the export log calls (every file is recorded on the server)
- PDFs are made on the server (`ReportPdfService`), and **scheduled report emails** (Reports Center → Scheduled emails, `hrms.report.schedule.manage`) send any report weekly or monthly as a PDF to workspace members who can open it.
- `useReportCompany` shares the company filter through `?co=` (old `?company=` links still work). If a role can't list companies, it uses the person's own company and locks the picker.

**Who sees what:**
- **Workforce Analytics:** opens with any of `hrms.report.headcount`, `hrms.report.attrition` or `hrms.report.diversity`. Each chart, stat card and table column shows only with its own permission; gender comes only from the diversity report.
- **Department clicks:** open the Workforce Directory only for people with `hrms.employee.read`.
- **Report pages:** each keeps its own permission. The Reports Center shows only the cards you may open.
- **Nav fix:** the Workforce Analytics nav entry now also appears to non-admin roles that hold a report permission (FINANCE_LEAD had all five report permissions and couldn't see it).
- **Search fix:** search offered Workforce Analytics to anyone with `hrms.employee.read`; it now uses the report permissions.

**Checked live:** `e2e/recovery/live-design-reports.mjs`, 56/56.
- Workforce Analytics:
  - headcount and this month's exits match the database
  - no one is dropped from the gender split
  - department CSV, `.xlsx` workbook, chart PNG and PDF snapshot all work
  - a department click opens the directory filtered to it
- All six reports render. Server CSV and `.xlsx` download from each.
- Reports Center:
  - every card shows
  - Recent downloads lists the files
  - a card keeps the chosen company
- No sideways scroll on a phone.
- FINANCE_LEAD sees and opens Workforce Analytics.
- Reader and manager are kept out, and no report API is called for them.

**Backend fixes** (`ReportService`; running locally, pushed to main):

| Report | Was | Now |
|---|---|---|
| Headcount | Filtered on `date_of_termination`, which the exit flow never sets, so every exited person was still counted (12 of 32 locally). | Leaving is by status plus last working day; someone on notice still counts. Adds `department_id` for drill-down. |
| Attrition | Counted people still serving notice as exits. "Resignations" only matched `RESIGNED`, which the exit flow never uses. Months without exits were missing. The rate divided by a count that included exited people. | An exit is `EXITED`, `TERMINATED` or `RESIGNED`, dated by last working day. Every month in the range is returned. New `other_exits` and month-end `headcount`. The rate is exits over the month's average headcount. |
| Diversity | Counted only `ACTIVE` people and silently dropped anyone without a gender. | Counts active, probation and notice. Missing gender is `NOT_SPECIFIED`. Adds `department_id`. |

| Item | Status | Detail |
|---|---|---|
| Workforce Analytics page (all seven states, charts, table, mobile cards) | Done | "Company list not allowed" couldn't be tested live: every seeded role that can see reports can also list companies. |
| Export → Dashboard snapshot (PDF) | Done | A direct download made on the server (`/v1/reports/workforce-analytics/export.pdf`, and `/v1/reports/{report}/export.pdf` for each report page): KPIs, charts and table, the company's name, each section only with its own report permission. |
| Export → Excel and CSV; chart PNGs | Done | Excel and PNG are built in the browser from the numbers on screen. Report CSVs come from the server routes. |
| Recent downloads (Reports Center) | Done | Reads the server export log (`hrms.report_exports`, `GET /v1/reports/exports`): every CSV, Excel, PNG and PDF export and every scheduled email, with who, the filters, the company and when. HR (`hrms.report.exports.read_all`) sees everyone's, with an Only mine switch; others see their own. It can't be cleared. |
| Attrition split (resigned / terminated / other) | Done (w1d, V143_13) | HR records the exit type (Resignation, Termination, Retirement, End of contract, Absconding, Death, Other) on Start notice / Mark exited and in the separation editors; `hrms.employees.exit_type`. The report splits on it; exits recorded before it existed count as "other". |
| Headcount on a past date | Done | The split uses each person's status on that date, from `hrms.employee_status_history` (a trigger records every status change; existing people were backfilled from their joining, confirmation, notice and exit dates). Someone whose exit is still to come counts as on notice. |
| "No department" click | Done | Opens the directory with its new "No department" option (`departmentId=none`; the API takes `noDepartment=true`). |
| "N in directory" (Total headcount card) | As designed | Counts every record in the directory, including people who have left. |
| Headcount CSV | Changed | Now also has a `department_id` column. |

**Still to do in the backend batch:** the headcount query briefly carried gender counts too. They were removed so gender stays behind the diversity permission, and that goes live with the next backend rebuild.

## 10. Backend fixes batch (25 Sep): done

Found while redesigning the pages above. Fixed in the backend, running locally, and pushed to main. Checked with `e2e/recovery/live-backend-fixes.mjs` (9/9); everything it changes is put back. The Master (41/41), Workspace (22/22) and Reports (56/56) tests still pass on the rebuilt server.

| # | Bug | Fix |
|---|---|---|
| 1 | The weekly summary called **today "Absent"** before the person had punched in. Days before their attendance started were "Upcoming". The monthly stats and history counted today as an absence too. | Today with no punch is `NOT_MARKED`, and so are days before attendance started (an existing status, so the mobile app doesn't see a new value). The monthly absent count and score skip today, and the history leaves today out. The web week strip reads "Not marked yet" / "Not tracked". |
| 2 | **Leave counted Saturday and Sunday as off for every company**, and **never excluded company holidays**: it read `leave_mgmt.holiday_calendars`, while Settings → Holidays writes `settings.holiday_calendar`. The leave form previewed with the company's days, so the days deducted could differ from the preview. | Leave uses the company's weekly off days (HR Configuration; Sat+Sun if unset) and the Settings holidays (plus anything in the old table). New employees' weekly offs also start from the company setting instead of a fixed "6,7". |
| 3 | The **classifications list** was gated on role names (HR_MANAGER / COMPANY_ADMIN / SUPER_ADMIN): Roles & Permissions had no effect, and OWNER/ADMIN were shut out. `/employees/by-ids` also let DEPT_MANAGER read any employee record by id, although managers had `hrms.employee.read` removed (V112). | Both now check `hrms.employee.read`. **Check the mobile app:** if it calls `/employees/by-ids` as a manager, it now gets 403. |
| 4 | Adding a salary component with an **existing code answered "201 Created" but saved nothing**. | 409 "A salary component with code 'X' already exists". Codes are trimmed and upper-cased. |
| 5 | Reading the shift list **re-created any default shift** (General / Morning / Afternoon / Night) that an admin had archived or renamed, and any employee's read could do it. | Defaults are seeded once, for a company that has never had a shift. Archived and renamed shifts stay as they are. |
| 6 | **Employee counts** on companies, branches, departments and designations came from cached columns nothing ever updated: 1 for the rows created at signup, 0 for everything later. | Counted live (active, probation and notice). The Companies page now shows real numbers. Contractor and classification counts can't be counted (employees aren't linked to them) and are left as they were. |
| 7 | Reports (see §9): headcount, attrition and diversity counted the wrong people. | Fixed. The gender columns briefly added to headcount were removed so gender stays behind the diversity permission. |

**Still open (noted, not changed):**
- *Payroll* treating Saturday and Sunday as off for everyone: done in w1b after the client decided (D1). Each employee's own weekly off, else the company's, else Sat+Sun, and holidays from Settings plus the old leave table, as leave and attendance count them.
- ~~The alternate `CanonicalAttendanceService` (only used by the `canonical-jdbc-api` profile) has the same "today is absent" and Sat/Sun rules.~~ **Done (w2i):** both services share `AttendanceCalendar`. Weekly offs are the person's own, else the company's (HR Configuration), else Sat + Sun (the live service now falls back to the company too). Today with no punch is `NOT_MARKED`, days before attendance started aren't absences, holidays and approved leave count as before, and late is after the shift start plus grace. Tests: `AttendanceCalendarTest`, `CanonicalAttendanceRulesTest`.
- ~~A company that had only the old "Standard 9-6" shift no longer gets "General" added automatically.~~ Done 25 Sep (w2d): such a company gets "General" once (V143_23 for existing companies, on first read of the shift list for new ones).

## 11. Full redesign: the module kit, then module by module

Only Master, Attendance, Payroll, Companies, the employee workspace, settings and reports had designs. Every other module is now rebuilt from the parts those designs use, collected in `src/design/module/ModuleKit.tsx`:
- the page header on the design's 28px rhythm
- the design's view tabs (`SubTabs`)
- stat tiles (`StatTile`)
- section headings with an icon tile
- quiet loading, error and empty states (`SectionState`)
- approval cards (`ApprovalCard`)
- list rows, form panels, fact tiles, notes, and the dark toast

The same classes of components means these pages match the designed ones and each other.

### 11.1 Leave (`/hrms/leave`): done
- **Views and who sees them:**
  - My leave, Apply and Balances: everyone except admins (the client's rule).
  - Approvals and Decided: people with `hrms.leave.approve.l1`; WFH cards need `wfh.approve` to decide.
  - Calendar, Leave types and Holidays: everyone; editing stays permission-gated.
  - The view is in `?tab=`, as before, so notification and dashboard links still land on the right view.
- **Approvals:** one queue of approval cards for leave and work from home, with a decision note. Rejecting WFH asks for a note (the server requires one). Each queue loads only for people who may decide it; employees used to trigger refused calls here.
- **Apply:** balance tiles and a form panel. The preview counts days minus the company's weekly off days and says holidays come off when sent. Overlap, balance, past-date and reason checks are as before.
- **Cancel:** now asks first, in a dialog.
- **Bug fixed:** the leave form and leave calendar compared the API's ISO weekdays (Sat = 6, Sun = 7) with JavaScript's `getDay()` (Sun = 0). Sunday counted as a working day in the preview, and the calendar greyed out only Saturday. A shared `jsWeekendDays` now converts them.
- **Navigation fixed:** employees had no Leave entry (the Leave group is for approvers), and "Me" appeared twice. There is now one "Me" with Overview, Attendance, Leave, Payslips, Salary, Work from home and Shift change as tabs. The last three were reachable only through links before.
- **Checked live:** `e2e/recovery/live-design-leave.mjs`, 11/11. The employee's nav and views are right; a Fri–Mon request previews and saves 2 days; the owner approves it from its card; the employee cancels through the dialog; no refused calls. The request and balance are put back afterwards.

### 11.2 My workspace (`/me`, `/me/payslips`, `/me/salary`, `/me/wfh`, `/me/shift-change`): done
All five are on the module kit, as tabs under the employee's one "Me" rail item.
- **Overview:**
  - this month's attendance as stat tiles (each opens Attendance)
  - leave balances and recent requests
  - a "Requests and records" list (work from home, shift change, payslips, salary, onboarding, profile), each shown only when its page would open for the person
  - attendance history and daily time entries, restyled
- **Payslips:** this year's take-home, gross and deductions as tiles, then one row per month with status and PDF. Done in w1b: a final month opens the design's payslip drawer with the employee's own lines (`GET /v1/payroll/payslips/me/{runId}`; 404 for any run without a payslip for them).
- **Salary:** CTC, gross, deductions and take-home tiles, the tax regime and PF, then earnings and deductions tables (monthly and yearly).
- **Work from home:** request form with the same rules as the mobile app. A panel explains what an approved day changes (check in from anywhere, marked WFH). Cancel asks first.
- **Shift change:** current and scheduled shift as fact tiles, the request form, and past requests with HR's notes. Same rules as before.

### 11.3 Expenses (`/hrms/expenses`) and salary advances for non-admins (`/hrms/advances`): done
- **Expenses:**
  - **Views by permission:** Approvals (approve or reimbursement), My claims and Submit (`claim.self`), Reimbursement batches, and Policies.
  - **Approvals:** stat tiles, then decision cards: "Waiting for your OK" (Approve or Reject; Reject asks for an optional reason in a drawer), then "Approved, to be paid" (Mark reimbursed). Each card opens its line items.
  - **Submit:** form panels with the per-category limit hints as before.
  - **Policies:** a note on how limits are checked, and an edit form with Save and Cancel (edit used to share the Add button).
- **Advances** (people without the payroll admin view; admins keep the designed page):
  - My advances: tiles and rows with the amount left to repay.
  - Request: a form showing the monthly deduction.
  - Approvals: decision cards with the existing approve and disburse actions.
- **New kit part:** `DecisionCard`, the ApprovalCard's look with slots for details and custom actions.
- **Fixed:** a new expense line's default date was the UTC date (yesterday before 05:30 IST).
- **Receipts: done (w1d).** Each line of a new claim takes a receipt (PDF, PNG or JPEG, 10 MB), uploaded to the private document bucket before the claim is sent (`POST /v1/expense/receipts`); a claim may only reference receipts its claimant uploaded. My claims can attach or replace one until the claim is decided. Line items (My claims, approvals, the employee record) open it through a signed link; decision cards show how many lines have one. `requiresReceipt` on policies is shown as a hint, not enforced: the policy form has no switch for it and the column defaults to true, so enforcing it would block claims in every workspace with a policy.
- **Checked live:** `e2e/recovery/live-design-expenses.mjs`, 11/11. The employee sees only their views and submits a claim; the owner opens its line items, approves it and marks it reimbursed; batches and policies render. The claim is removed afterwards.

### 11.4 Resignation & exit (`/hrms/exit`) and Full & final (`/hrms/fnf`): done
- **Resignation & exit:** on the module kit: stat tiles (each opens its list), view tabs with the on-notice count, and quiet states. The notice, withdraw, mark-exited and F&F hand-off behave as before.
- **Full & final:** on the module kit.
  - **Views:** Pending approval, Pending payment, Settled, All, and Create settlement.
  - **Default view:** someone who can record payments but not approve now starts on **Pending payment**. Before, they started on Pending approval, where approved settlements never appear.
  - **Settlement drawer:** earnings, deductions and net payable as fact tiles.
  - **Create:** form panels.
- **Fixed:** the kit's error state used the design's fixed "Unable to load this section." and dropped the server's reason. It now shows the real message.
- **Checked live:**
  - `live-exit-center` 12/12 and `live-employee-exit` pass.
  - `live-fnf-tabs` 27/27. Updated because the view tabs are pressed-state buttons, not ARIA tabs, and a zero count shows no badge.
  - `live-fnf-admin` passes all three steps. This was the open failure: the payer was looking for the approved settlement under Pending approval.

### 11.5 Dashboard for every role (`/dashboard`): done
- **Who gets which dashboard:**
  - Before: HR managers, finance leads and department managers got the old role dashboard; only admins had the designed one.
  - Now: every role except plain employees gets the designed dashboard. Each of its cards was already gated by the permission its data needs.
  - Plain employees keep their staff dashboard, and their landing page is My workspace.
- **Fixed:**
  - Upcoming probations called `/v1/probation/upcoming`, which needs `hrms.employee.read`, for managers who don't hold it (a 403 on every visit). The query and card are now gated.
  - For a non-HR role with no team roster today, "Total Employees" showed 0 above "6 active". It now shows the directory's active count.
- **Checked live:**
  - The manager and finance lead dashboards make no refused calls.
  - `live-design-dashboard` 12/12 and `live-staff-dashboard` 12/12.

### 11.6 My team (`/team`): done
- **Layout:** on the module kit, in this order:
  - today's tiles: Present, Not marked yet, On leave, and Waiting for you
  - leave waiting for the manager, decided right on the page with the same cards as Leave (it used to be a list with a link to the Leave page)
  - "Who's in today" with punch times
  - the week's shift roster
- **Fixed:**
  - Leave approvals are only fetched for people with `hrms.leave.approve.l1`; managers without it got a 403.
  - Roster names linked to the employee page, which managers can't open (no `hrms.employee.read`). They link now only for people who can.
  - The roster showed only the first 8 people; now everyone is listed.
- **Note:** the attendance API counts someone with no punch today as both "not marked" and "absent" (absent = no punch and no leave so far, by design). The page shows "Not marked yet" for today so it matches the rows.
- **Checked live:** `e2e/recovery/live-design-team.mjs`, 7/7.

### 11.7 Hiring (`/hrms/hiring`): done
- **Layout:** on the module kit, with three views: Pipeline, Requisitions and Offers (`?tab=`).
  - **Pipeline** is a board with one column per stage. Each candidate card has a "Move to" select, "Convert to employee" once they are HIRED, and "View employee" after conversion.
  - **Requisitions** has stat tiles at the top. Each row links to its pipeline (`?tab=pipeline&role=<id>`), so a role can be shared as a link.
  - **Offers:** statuses read as words (Sent, Accepted, Withdrawn), and dates use the Indian format.
- **Permissions:** Pipeline and Requisitions need `hrms.hiring.read`. Offers need `hrms.hiring.offer.read`, because offers carry salary. Someone with neither sees "No hiring access".
- **Built 25 Sep (w2a, V143_20):**
  - **Drag between stages:** candidate cards drag onto another column (HTML5 drag and drop). A column only accepts a drop the server allows (one step forward, or Rejected / Withdrawn) and its border turns green while you hover it. The "Move to" select stays as the keyboard-accessible way. Both call the same stage API.
  - **Board filters:** Role has **All roles**, and a **Stage** filter shows one column. Withdrawn candidates now have their own column (they were hidden before).
  - **Interviews:** "Interviews & scorecards" on each card opens the candidate: their facts, scorecard summary and interviews. HR (`hrms.hiring.interview.write`: Owner, Super admin, HR manager) schedules an interview while the candidate is in Screening or Interview: date and time in IST, duration, in person / video call / phone, the place or link, 1–10 interviewers (employees), and the criteria they rate (the standard four by default). Reschedule and cancel while no feedback is in. Once an interview has started it can still be changed if its time is kept, so HR can add the person who actually took it and they can file a scorecard. Interviewers are notified in-app and by push when they are added, when the time, place or mode changes, when it's cancelled, and when they are taken off.
  - **Scorecards:** once the interview has started, each assigned interviewer rates every criterion 1–5, adds strengths and concerns, and recommends strong yes / yes / no / strong no. Hiring roles (`hrms.hiring.read`) see every scorecard; an interviewer sees only their own. The card shows "N scorecards · average / 5 · recommendations" and the next interview.
  - **Interviews view** (`?tab=interviews`): tiles, "Your interviews" (submit your scorecard) and the upcoming interviews with Reschedule / Cancel and "Open pipeline".
  - **Fixed (review):** links inside the Hiring page (a requisition's "Pipeline", an interview's "Open pipeline") changed the address but left the old view showing. The page now follows `?tab=` on every in-app link.
  - **My interviews** (`/me/interviews`, `hrms.hiring.interview.self`, every employee): the interviews you were asked to take, with your scorecard. The notification opens it, and My workspace shows an "Interviews" shortcut when you have any.
  - Department managers see the board and scorecards and can be interviewers, but don't schedule (they can't browse the directory to pick interviewers).
- **Checked live:** `live-candidate-conversion` 13/13 and `live-offers-browser`, which passed. API test for this batch: `e2e/recovery/live-w2a.mjs`.

### 11.8 Onboarding & assets (`/hrms/onboarding/instances`, `…/instances/:id`, `…/instances/new`, `/hrms/onboarding`, `/hrms/onboarding/templates/:id`): done
- **Layout:** on the module kit.
  - One page with three views: New hires, Assets and Checklist templates (`?view=`).
  - Templates used to be reachable only from a row menu; they are now a view on this page as well. `/hrms/onboarding` still works on its own.
  - **New hires:** clickable status tiles, and a table with a checklist progress bar on each row.
  - **Checklist page:** shows whose onboarding it is, a progress bar, and the tasks.
    - Task status reads "To do", "Overdue", "Done" or "Skipped".
    - Notes and completion times are shown. They were saved before, but never displayed.
    - HR can put the onboarding on hold, resume it or reopen it right from this page.
  - **Assets:**
    - Tiles for All, With employees and In store (which includes returned items, since those can be handed out again).
    - Search and a status filter.
    - Register, assign and take-back now open in drawers.
    - Statuses read "In store", "With employee" or "Returned".
  - **New-hire wizard:** sits in the kit frame, with a floating Back / Next bar. The steps themselves are unchanged.
- **Permissions:** the API decides whose onboardings each user gets back, and the page follows it.
  - **HR** (`hrms.onboarding.instance.write`) sees every new hire.
  - **Everyone else** with `instance.read` (employees, managers, finance) gets only their own onboardings. The view is called "Your onboarding" and has no table. Before, they saw a table of dashes because they can't read colleagues' names.
  - **Assets** need `asset.read` or `instance.write`. Only `asset.write` or `instance.write` can change them.
  - **Templates** need `template.read`.
- **Fixed (backend):** removing a task from a template that any started onboarding had used failed with a foreign-key error.
  - Migration `V143_8` clears the link instead. Started onboardings already keep their own copy of each task's title, owner and required flag, so nothing is lost.
  - Deleting a task now also checks that it belongs to the template in the URL. A task from another template returns 404.
- **Fixed (tests):** `live-onboarding.mjs` left its QA hire behind on every run, and later payroll and letter tests picked those hires up. It now deletes the hire at the end.
  - The older leftovers stay in local data. They are in payroll lines and letters from earlier runs, so removing them would mean editing past payroll.
- **Built 25 Sep (w2a, V143_20):**
  - **Reorder template tasks:** Move up / Move down on each task (`PUT /v1/onboarding/templates/{id}/tasks/order`, every task exactly once). New onboardings follow the new order; ones already started keep theirs, and the page says so.
  - **Owner role from a list:** the Add task drawer picks from the workspace's roles (`GET /v1/onboarding/owner-roles`, built-in and custom). The server refuses a role the workspace doesn't have.
  - **Hire details** on the checklist page: offer accepted, hiring manager, recruiter, source and buddy, filled from the hiring record and editable by HR (see §7). The new hire sees theirs.
  - **My assets** (`/me/assets`, `hrms.onboarding.asset.self`, every employee): what they hold now and what they returned (dates and the return note), from `GET /v1/me/assets`. In the Employee Self Service menu and on My workspace.
- **Checked live:** `live-design-onboarding.mjs` 34/34 (owner, employee and department manager, with cleanup) and `live-onboarding.mjs` (passes and cleans up).

### 11.9 Performance (`/hrms/performance`): done
- **Layout:** on the module kit.
  - HR and managers see three views: Review cycles, Employee reviews, and Goals & KPIs. The old page listed these three twice under a second set of names ("Employee Performance", "Appraisals & 360 Feedback", "KPI Tracking"), each opening the same screen.
  - Anyone who writes their own review also gets My reviews and My goals.
  - The chosen view stays in `?view=`.
- **My reviews** is split into "To write" and "Reviews and feedback".
  - Each card says what it is: your self review, feedback from a named reviewer, or your review of a named colleague.
  - A missed review explains that the cycle closed before it was submitted.
- **My goals:** stat tiles, a panel to add a goal, and one card per goal. Company KPIs assigned to you are marked, and only the performance admin updates them.
- **Admin views:**
  - Kit headings, and statuses in sentence case ("At risk", "Closed", "Missed").
  - Dates read like "1 Sep 2026".
  - Raw employee and reviewer UUIDs are no longer shown when a name or code is missing.
- **Permissions:** each view follows the API. Listing cycles, reviews and KPIs needs `hrms.performance.read`. Creating a cycle needs `hrms.performance.write`, assigning or closing one needs `hrms.appraisal.initiate`, and managing KPIs needs `hrms.kpi.manage`.
- **Built 25 Sep (w2b):**
  - **People** view (`hrms.performance.read`): the performance directory (`GET /v1/performance/employees`), team-only for department managers. Each person opens **their performance page** (`/hrms/performance/employees/:id`, `GET /v1/performance/employees/{id}`): rating and goal tiles, ratings over time (average of the submitted reviews per cycle), goals & KPIs with their progress history, and every review. A manager gets 403 outside their team. Also reached from the employee workspace's Performance tab and from names in Employee reviews.
  - **Writing a review** shows the reviewee's goals and KPIs for that cycle (target, current, status): goals tied to the cycle, plus untied goals live during it (`GET /v1/performance/reviews/{id}/goals`: the reviewer, the reviewee, or someone whose performance scope covers them). The admin review drawer shows them too.
  - **My goals → History**: each update's value, date, who recorded it and the note (`GET /v1/performance/goals/my/{id}/history`, own goals only). Saving progress on a personal goal takes an optional note and is recorded in the same history.
  - **Fixed in review:** the KPI drawer no longer records a value on a goal without a target. It used to write 0% over the percentage the owner had set (`PUT /v1/performance/kpis/{id}/progress` now answers 422 `KPI_TARGET_REQUIRED`; the drawer says to add a target).
  - Live test: `e2e/recovery/live-w2b.mjs` (API only; written, not yet run).
- **Open questions (your call, not changed):**
  - **ADMIN** holds `appraisal.initiate` and `kpi.manage` but not `performance.read`, so it can't list the cycles and KPIs it's allowed to manage. It needs either `performance.read` or neither of the other two.
  - **DEPT_MANAGER** has `performance.read` (V071, on purpose). The API then returns every review and KPI in the company, not just their team's. If managers should see only their team, the list endpoints need scoping.
- **Fixed (tests):** `performance-admin-live.mjs` left a KPI and a review cycle behind on every run, which is where the "Browser review cycle …" rows come from. It now deletes them.
- **Checked live:**
  - `live-design-performance.mjs` 18/18 (owner, department manager and employee; adds a goal and saves its progress)
  - `performance-admin-live.mjs` (passes and cleans up)

### 11.10 Learning (`/hrms/learning`): done
- **Layout:** on the module kit, with four views: Programs, My training, Skill matrix and Certifications (`?view=`).
  - **Programs:**
    - Tiles, plus a panel for a new program, which now lets you pick the company when there's more than one. It used to take the first company silently.
    - Status and enrollment labels are in words.
    - Programs you're already in show "You're enrolled" instead of an Enroll button that the server would refuse.
    - HR opens each program's roster from a "Roster" button.
  - **My training:** tiles, your programs as rows with Leave, and your own skills.
  - **Skill matrix / Certifications:**
    - A "whose record?" picker first, then the table, then an add/update panel.
    - The duplicate proficiency card that repeated the table was removed.
    - An expired certification shows a red "Expired" pill.
- **Fixed:**
  - Employees and managers could enroll in training but had no way to reach Learning. The sidebar item was limited to HR roles and `skill.read` holders. It now also shows for `hrms.learning.enroll.self`.
- **Permissions (unchanged):**
  - Catalogue: `learning.read`
  - Enroll, My training and your own skills: `learning.enroll.self`
  - Colleagues' skills: `learning.skill.read`
  - Create programs, change status, roster and edit skills: `learning.write`
- **Built 25 Sep (w2b):**
  - **Program detail page** (`/hrms/learning/programs/:id`, from the program title or **Details**): facts, description, enroll / leave, status, roster, and for `learning.write` an **Edit details** panel (title, description, category, trainer, mode, dates, seats or "No seat limit"). The server refuses seats below the people enrolled (or under 1), an end date before the start date, and any detail change on a completed or cancelled program. Programs now have a **mode** (in person, online, hybrid, self-paced; migration `V143_21`).
  - **Skill self-assessment**: under My training → My skills, an employee proposes a level (or a new skill) with a note (`hrms.learning.skill.assess.self`), sees what happened to it and can withdraw a waiting one. Their manager (team only) or HR (`learning.write`) decides in the new **Skill approvals** view (`hrms.learning.skill.approve`); a rejection needs a note. Approving writes the level to the skill matrix. Both sides get a notification. Nobody decides their own proposal.
  - Live test: `e2e/recovery/live-w2b.mjs` (API only; written, not yet run).
- **Fixed (tests):** `live-new-admin-browser.mjs` was stale since the Company redesign and never cleaned up.
  - It now uses the Learning views and opens the dashboard's Projects drawer.
  - Its geofence step was dropped, because `live-design-companies.mjs` covers the branch drawer.
  - It now removes its certificate and project.
- **Checked live:** `live-design-learning.mjs` 16/16 (owner, employee and department manager, with cleanup) and `live-new-admin-browser.mjs` (passes).

### 11.11 Statutory compliance (`/hrms/compliance`): done
- **Layout:** on the module kit, with four views (`?view=`) and the company picker beside them:
  - **Compliance calendar:** stat tiles and the obligations table, with a month grid underneath. Today and days with something due are highlighted, and clicking a day lists its deadlines.
  - **Statutory filings**
  - **POSH register:** its confidentiality note is in the kit's green style.
  - **Inspector access:**
    - A panel to give access, and a link panel with Copy.
    - Each inspection's shared PDFs open in a panel, with sizes shown.
    - Revoking now asks for confirmation first.
- **Fixed:**
  - New obligations, filings and complaints defaulted to yesterday before 5:30 am, because "today" was taken in UTC. It now uses the local date.
  - The calendar and filings views opened for anyone with `compliance.write`, but their endpoints need `compliance.read`, so a write-only role got 403s. They now require `compliance.read`.
  - Inspectors' shared documents can be listed by anyone who can read inspections, which matches the API. Only managing them needs write.
  - The access-end field is now limited to the next 7 days in the picker, the same as the server.
- **Fixed (tests):**
  - `live-inspector-browser.mjs` and `live-assets-browser.mjs` left their inspection, PDF and asset behind. They now remove them.
  - Six older "UI verification laptop" assets from earlier runs were deleted from local data.
  - `live-assets-browser.mjs` was updated for the new Assets drawers (it should have been in §11.8).
- **Checked live:**
  - `live-compliance-modals.mjs` 20/20
  - `live-inspector-browser.mjs` (passes: link, anonymous view, PDF, CSV, revoke)
  - `live-assets-browser.mjs` (passes)

### 11.12 Muster roll, Manual entry and Geofencing (`/hrms/muster-roll`, `/hrms/attendance/manual-entry`, `/hrms/attendance/geofencing`): done
- **Muster roll:**
  - On the module kit: a day bar (previous / date / next / Today, plus a department filter), stat tiles, the design's donut in place of the two charts that repeated the same numbers, and the register table.
  - The CSV export is recorded in the Reports Center's "Recent downloads".
  - The "Manual entry" row action shows only for people who can save one (`attendance.regularization.approve`).
- **Fixed (Muster roll):**
  - **Today no longer calls people "Absent"** just because they haven't punched yet. The tile and rows say "Not marked yet", and past days still say "Absent".
    - The number is the API's `absent` (no punch and not on leave), not `notMarked`, which also counts people on leave and so double-counted them.
    - Someone on approved leave without a punch reads "On leave".
  - The page now opens on `?date=`. Manual entry already sent people back to `?date=…`, but the page always opened on today.
  - (w1a) Each row's status and the tiles now use the day's effective status (company attendance policy + reviewers' changes), so an excused late arrival reads Present and a late arrival past the allowance can read Half day.
- **Manual entry:**
  - On the kit, in three panels: Who, When and Why.
  - Save failures now show the server's reason.
- **Fixed (Manual entry):**
  - The date was parsed as UTC midnight. That's right in India, but it shifts the day in time zones west of UTC; it now uses local time.
  - Roles without directory access used to fire a directory request that got a 403. They now go straight to their team roster.
- **Geofencing:**
  - On the kit: tiles, one card per zone (centre, radius, branch, department, check type, and a "View on a map" link), and a drawer form with the map picker.
  - "Delete" is now "Remove", with the true effect in its confirmation: the zone is deactivated, stops being used for punches, and leaves the list.
  - Branch names now show on the cards.
- **Static / to build:** none now. The Geofencing page was retired on 25 Sep (punch zones live on branches, §11.18), so restoring deactivated zones is no longer planned.
- **Checked live:**
  - `live-design-attendance-admin.mjs` 18/18 (muster today vs a past day, `?date=`, CSV and its record, a manual punch saved at 09:00 local and landing back on that day, zone add / edit / remove, department manager; with cleanup)
  - `live-design-attendance.mjs` 26/26

### 11.13 Documents and Letters (`/hrms/documents`, `/hrms/documents/pending`, `/hrms/letters/*`): done
- **Documents:**
  - On the module kit, with three views: My documents, Employee documents and Letter templates (`?view=`).
  - "Add document" is in the header and opens a drawer, replacing the old Upload tab.
  - A person's file is opened with the server-searched picker. The old dropdown listed only the first 200 employees.
  - Rows show the document type and review status (Verified, Waiting for review, or Rejected with the reason) alongside the expiry badge.
  - **Add document:**
    - Offers the admin-configured document types. The server's allowed formats and size limit are checked before upload.
    - A link can still be used instead of a file.
- **Documents to review:**
  - Each document is a decision card showing the employee, document, type, file name and size, and when it was uploaded.
  - **View file** fetches the signed link, because the queue itself carries none. When storage isn't set up it says so instead of opening nothing.
  - Reject needs a reason (at least 3 characters), which the employee sees.
- **Letters:** templates, generated letters, a single letter, distributions, a single distribution and the template editor are all on the kit frame.
  - Employees see "My letters".
- **Fixed:**
  - When document storage isn't set up, a file had a link that did nothing (the API returns no link). It now reads "File can't be opened here".
  - Employee documents missed anyone past the first 200 people.
  - The Letter templates view inside Documents showed a second page header.
  - Generated letters showed an 8-character UUID when the employee code was missing. A letter showed "Generated By" and "Template ID" as UUID fragments. All of these are removed.
  - A distribution that failed to load showed a skeleton forever. It now shows an error with Try again.
  - Failed deletes and retries now show the server's reason.
- **Checked (security):** the review queue's SQL has no tenant filter. It relies on row-level security, which applies because the app connects as `ut_app`, not the table owner, so there's no leak. *Done (w1d, V143_13):* RLS is now FORCEd on `document_mgmt.employee_documents` and `document_types` where the owner isn't the app role, so it also holds for the owner.
- **Done (w1d):**
  - **Edit** on each Employee documents row: type, title, category, dates, notes, link, or replace the file (`PUT /v1/document/documents/{id}`). A new type must fit the kept file; a replaced file lands verified and the old one is deleted (the drawer warns).
  - **Bulk upload** (header): several files at once, each assigned to an employee and a document type; each goes through the single-file upload so its type's formats and size are enforced, with a per-row result and retry.
  - New workspaces get the ten default document types on their first read of the list (V143_7 only seeded the workspaces that existed); V143_13 backfills any that have none.
  - An upload over the multipart limit is a 400 "File is too large (max N MB)", not a 500.
- **Static / to build:**
  - ~~The Letters pages are separate routes linked from the Hiring sub-navigation; there's no single "Letters" hub.~~ **Done (w2i):** see "Letters hub" below.
- **Fixed (tests):** `letters-admin-live.mjs` left its template and letter behind. It now removes them.
- **Checked live:** `live-design-documents.mjs` 19/19 (HR adds by link → employee sees it → HR deletes; pending card, View file, reject with reason, verify; every letters page; with cleanup) and `letters-admin-live.mjs` (passes).
- **Letters hub (w2i): done.** `/hrms/letters` is one page on the module kit with four views:
  - **Templates** (`hrms.letters.template.read`), **Generated letters** (`hrms.letters.read`), **Distributions** (`hrms.letters.distribute` or `hrms.letters.read`) and **My letters** (`hrms.letters.read.self`).
  - The old routes keep working and open their view: `/hrms/letters/templates`, `/generated`, `/distributions`, plus `/my`. Someone who can only read their own letters and follows an old `/generated` link lands on My letters, as before.
  - The header button follows the view: Create template, Generate letter (also opened by an employee's "Generate" link, `?employeeId=`), New distribution.
  - An employee sees only My letters, titled "My letters". They reach it from **Me → Letters** and a "Letters" shortcut on My workspace (neither existed).
  - The sidebar has one "Letters" entry instead of three. Distributions now page past 20 jobs.
  - `live-design-documents.mjs` was updated for the hub's view tabs (not run here).

### 11.14 HR setup: Policies (for non-admins), Notification templates and Integrations: done
- **Policies (`/hrms/policies`):**
  - Admins still get the Master module's Policy documents (§6).
  - Everyone else gets the kit version.
    - If Policies is all they can open, the page is titled "Policies" and says what it's for. Otherwise it's "Rules & policies", with views for Policies, Shift rules, Leave rules and Manage.
    - Tiles show "You've acknowledged" and "Still to acknowledge", and each policy card has a To acknowledge / Acknowledged pill.
- **Fixed (Policies, backend and frontend):**
  - A role holding only `hrms.policy.acknowledge.self` saw "No policies access", because listing needed `hrms.policy.read`. You can't acknowledge what you can't read.
  - `GET /v1/policy/policies` and `/{id}` now also accept `acknowledge.self`. The existing rule still limits non-authors to ACTIVE policies, so drafts and archived policies stay author-only (checked: 403).
  - `useVisibleTabs` now accepts a list of permissions, any one of which will do.
- **Notification templates:**
  - On the kit: tiles, the table with paging (it was stuck on page 0), and a drawer to add or edit. There's also an error state, which was missing.
  - **Done (w1c):** every sender (in-app and push texts, invitation, password reset, offer, letter, distribution and probation reminder emails) uses the company's active template for the event and channel, fills `{{placeholders}}` (HTML-escaped in email) and falls back to the built-in wording. The event is picked from `GET /v1/notiftemplate/events` (description, who gets it, placeholders, built-in wording); the server refuses unknown events, channels and placeholders. The amber note is gone. Live test: `e2e/recovery/live-w1c.mjs`.
- **Integrations:**
  - On the kit: tiles, a "Record a service" panel, and the table.
  - "Recorded" now shows the creation date. The old "Registered" column showed `lastSyncedAt`, which nothing ever sets, so it was always blank.
  - The note that status is set by hand, with no connection or sync, is kept and made more prominent.
  - **Static / to build:** real connections (OAuth, API keys, sync) don't exist yet. This is a register.
- **Checked live:**
  - `live-design-hrsetup.mjs` 17/17, including a real acknowledge-only user: `policy.read` was removed from the local EMPLOYEE role, the test waited out the server's 5-minute cache, then put it back.
  - `live-design-master.mjs` 41/41

### 11.15 Users & access, Roles & permissions, Audit logs (`/users`, `/roles`, `/audit-logs`): done
- **Users & access:**
  - On the module kit.
  - Clickable tiles: Members, Active, Invited and No access yet. Filter views match them.
  - Search, and roles grouped by module.
  - A failed invitation email is shown under the status, and "Resend invitation" becomes "Retry invitation".
  - The list now has an error state with Try again; before, it said "Please try again" with no button.
  - The invite modal and the Manage access drawer are unchanged.
- **Roles & permissions:**
  - On the kit.
  - Tiles: Roles, Built-in, Custom and Permissions.
  - Views: Roles, Who has which role, and Permission catalogue (`?view=`).
  - The catalogue gains a search across code, name and description, alongside the module chips.
  - Granting or removing a role now shows the server's reason when it fails.
- **Audit logs:**
  - On the kit.
  - Each row shows the absolute time as well as "2 hours ago", and actions and resources read as words.
  - A line gives the total count.
  - The details drawer shows who, when, action, IP and device, then the IDs, then what changed.
- **Fixed (Audit logs):** the date filter sent the "To" day as its UTC midnight, which dropped that whole day, and shifted "From" by 5½ hours. Both now use local day boundaries: "To" includes the whole day.
- **Added (Audit logs):** "Export all (CSV)" downloads every event matching the filters from `GET /v1/audit/events/export.csv` (streamed by the server, newest first, sensitive fields masked). The export is recorded in the Reports Center's download history and in the audit trail. The "Who" filter now also takes an email address, and each row names the record it's about.
  - **Done:** the full server export of the trail.
- **Checked live:** `live-design-access.mjs` 16/16 (users tiles, filter and search; a temporary role granted and removed from the drawer; built-in roles read-only; catalogue view and search; the audit day filter matching the API over the full local day; CSV export; event details; the temporary role removed).
- **Done (w1h, migrations `V143_17`, `V143_17_1`): per-person permissions, duplicate roles, levels, descriptions, no role-name bypasses.**
  - Manage access drawer: new "Extra and removed permissions" section (search the catalogue, reason required, optional end date) and "What they can do" with the source of every permission (role, every employee, extra). API `GET/PUT /v1/workspace/users/{id}/permissions`, new permission `rbac.access.manage-overrides` (critical). Effective = (roles + employee baseline + extras) − removed, in the sign-in token, `/me` and `@perm`.
  - Roles: "Duplicate role" (`POST /v1/rbac/roles/{id}/duplicate`) opens the copy's permissions next; delete says who holds the role; errors show the server's reason.
  - Levels: nobody changes their own access; only the owner changes the owner; you only give roles or permissions you hold; critical permissions and the Owner / Super admin roles only from the owner; high-risk grants ask for confirmation (the server insists). Every change is in the audit log.
  - Every permission has a description and a risk level (Low / Medium / High / Critical); High and Critical carry a warning. Shown in the catalogue, the role editor and the drawer.
  - Role-name checks replaced by permissions across `/v1/employees`, settings, tenant compat, milestones, attendance and performance scope, plan and module buying (new `hrms.employee.team.manage` for department managers). Built-in roles keep their access.
  - Live test: `live-w1h.mjs` (API only).

### 11.16 PLI for employees, Employee import, Bank profiles & payment tools: done
- **PLI (`/hrms/pli` for people without the admin view):**
  - On the module kit, titled "My incentives".
  - Tiles: Waiting for approval, Approved (to be paid), and Paid to you.
  - Statuses read as words: a rejected award reads "Not approved".
  - There's now an error state with Try again.
  - Admins still get the designed Payroll → PLI page.
- **Employee import:**
  - Kit frame, with the old breadcrumb row removed.
  - The validation result is kit tiles: Rows in the file, Ready, Problems.
  - The failure state now says trying again is safe. That's checked in the backend: commit validates the whole file first and rejects any email that already exists, so nothing is created twice.
- **Bank profiles & payment tools (`/hrms/bank-disbursement/setup`):**
  - Kit frame, with a link back to the designed Bank disbursement page.
  - Kit tiles, and run statuses read as words ("Paid", not "PAID").
- **Left as they are (outside the HRMS scope you set):** the Modules launcher and the Plan / billing page each have their own full designs, and ModuleWorkspace is the non-HRMS apps' shell.
- **Tests brought up to date:**
  - `live-dead-entrypoints.mjs` now follows the redesigned My workspace wording (29/29).
  - `live-browser.mjs` now checks the designed dashboard instead of the old "Live overview" region. Every `/hrms` route, plus Settings, Users and Roles, renders its heading with no failed calls.
- **Checked live:** `live-design-last.mjs` 10/10.

### 11.17 Performance access decided with the client (25 Sep): done
- **ADMIN runs performance like HR** (migration `V143_9`).
  - It already held `hrms.appraisal.initiate` and `hrms.kpi.manage`, but without `hrms.performance.read` it couldn't list the cycles, reviews or KPIs it was allowed to manage.
  - It now also has `hrms.performance.read` and `hrms.performance.write`, so it can create cycles, assign and close them, and create KPIs and record their progress.
- **Department managers see only their team** (`PerformanceTeamScope`). "Team" means the same as on the My team page: everyone in the departments they head, or their direct reports if they head none, and never the manager themselves. This applies to:
  - the employee reviews list
  - each cycle's progress
  - the KPI list, detail and history
  - the performance directory (`/v1/performance/employees`)
  - Before, all of these except KPIs were company-wide, and KPIs used direct reports only.
- **Managers record progress on their team's KPIs.**
  - New permission `hrms.kpi.progress` goes to DEPT_MANAGER. OWNER and SUPER_ADMIN also get it, because the startup check `OwnerPermissionInvariantCheck` requires OWNER to hold every permission.
  - The API only allows it on KPIs owned by their team. Managers still can't create or drop KPIs.
  - In the UI they see "Your team's goals & KPIs" with a note, and an "Update progress" button.
- **Fixed: overdue KPIs never turned "At risk".** `KpiService.flipOverdueToAtRisk` existed but nothing called it. The new `KpiAtRiskJob` runs nightly at 00:15 IST and at startup, for every tenant.
- **Fixed (found while checking): Manual entry offered Save to department managers.**
  - Saving needs `attendance.workforce.admin` since V143.5, so the server refused them.
  - The page and the Muster roll "Manual entry" button now use that permission.
- **Checked:**
  - `live-performance-scope.mjs` 20/20 against the local server. It covers the team-only lists, progress allowed for the team and refused outside it, and ADMIN (granted to a test user and taken back) seeing and recording everything. It seeds a review outside the team so the check is real, and removes everything afterwards.
  - The startup sweep marked a seeded overdue KPI "At risk" (server log: "1 KPI(s) marked at risk").
  - `KpiAccessScopeTest` now has 7 tests.
  - `live-design-performance.mjs` 18/18 and `live-design-attendance-admin.mjs` 18/18.
- **Built 25 Sep (w2b)** (see §11.9):
  - The per-employee performance directory has a UI (Performance → People, and a page per person).
  - Employees see each KPI's progress history (value, date, who, note) under My goals.
  - A review shows the reviewee's goals and KPIs for the cycle while it's being written.

### 11.18 Search palette, "/" navigation, permission-only menus, hidden dashboard sections, Geofencing retired (25 Sep): done
- **Search palette (⌘K / Ctrl+K, and the top-bar field):** same blurred backdrop; the modal itself is rebuilt on the kit's tokens.
  - Groups: **Pages** (every page and sub-tab the person may open), **Actions** (apply leave, request WFH, ask for an attendance fix, run payroll, add an employee, set a branch punch zone… only those the person can complete), **People** (`GET /v1/search`, directory permission) and **Recent** (shown when the box is empty, with Clear).
  - Matching is partial and forgiving: prefixes, initials ("wfh", "fnf"), one typo per word, letters in order; the matched part is highlighted.
  - Keyboard: ↑ ↓ (wrap), ↵ opens, Tab completes a "/" path, Esc closes. The footer shows the keys. Empty, no-results, people-loading, people-error and too-many-people states each say what's happening.
  - People search now matches word by word on the server: "rah ver" finds Rahul Verma, "sales priya" finds Priya in Sales (name, code, email, department, designation). Ranking and the `hrms.employee.read` gate are unchanged.
  - Recent items stay in this browser per person and workspace, and are re-checked against the current permissions before they're shown.
- **"/" navigation:** typing "/" switches to path mode.
  - `/attendance` opens the first Attendance & Time page the person may open (Analytics for HR, Daily Tracking for an employee); `/attendance/daily-logs`, `/attendance/dailylogs` and `/attendance/daily logs` open that tab; `/attendance/daily-tracking` opens Daily Tracking. Every module and tab has a path (`/leave/approvals`, `/payroll/runs`, `/settings/users`…), and real routes (`/hrms/leave`) work too.
  - Suggestions list only permitted paths as you type; "/" alone lists every area you can open.
- **One registry:** `src/shared/navigation/pageRegistry.ts` lists every page and tab with the permissions its route and tab check and the module it sits behind (built from App.tsx and each page's `?tab=` / `?view=` rules). The menu, launcher, search and "/" paths all read it. When a route or tab changes, change it there.
- **Menus are permission-only:** a link shows when the person holds its page's permission and the workspace has its module; role names no longer decide. Self-service ("Me") shows for anyone with their own employee record and the self permissions (so HR and managers get their own leave and payslips too); "My team" is for team-scoped approvers (approve leave or read team attendance, without the full directory). The Settings gear follows the settings permissions. Consequences worth knowing:
  - Links that used to show but then said "Access Restricted" are gone (e.g. Companies & Branches for ADMIN, which lacks `hrms.branch.read`).
  - Roles holding a permission now see its page (e.g. HR sees Payroll Dashboard, Salary Structure and F&F because it holds `payroll.runs.read` and `hrms.fnf.*`; managers see Shifts & Overtime and Muster roll). Change the role's permissions in Roles & Permissions to change what they see.
- **Coming-soon and locked modules are admin-only everywhere:** the launcher, menu, search and the routes themselves show them only to plan admins (Owner, Super Admin, Company Admin), who keep the request-module flow. Anyone else is sent home, and an old link to a module the workspace doesn't have says to ask an administrator instead of offering to buy it.
- **Dashboard sections without permission are hidden:** each section and card (Live overview, Company summary, Attendance analytics, Dept distribution, Top performers, Onboarding, Hiring, Projects, Payroll, Activity, Notices, Probations, Operational insights) shows only with the permission its endpoint checks; the "Open directory" link needs the directory. Built by `scripts/design-build.mjs` (no hand edits to the generated view). Dashboard quick actions show only when they can be used.
- **Geofencing retired (decision D3):** `/hrms/attendance/geofencing` redirects to Companies & Branches; it's gone from the menu and search, and "geofence" in search leads to Companies & Branches. Branch geofences (`PUT /v1/hrms/branches/{id}/geofence`) and the punch check that reads them are unchanged. Existing per-employee zone overrides keep working and stay editable from the employee form.
- **Checked:**
  - Unit tests: `src/shared/navigation/pageRegistry.test.ts` (11) and `src/shared/search/search.test.ts` (13) pass; backend `EmployeeSearchQueryTest` (4) passes.
  - `e2e/recovery/live-w1g.mjs` (API only, not yet run): word-by-word people search against the database, 403 for roles without the directory, each menu rule's endpoint answering exactly the roles the link shows for, each dashboard section's endpoint refusing exactly the roles it's hidden from, coming-soon modules, and a branch geofence saved by HR (refused for manager and employee) and used by the employee's punch check, then restored.
  - `live-design-attendance-admin.mjs` now checks the Geofencing redirect instead of adding a zone.

### 11.19 Leftovers batch (w2i, 25 Sep): done
- **Letters hub** (§11.13), **CanonicalAttendanceService parity** (§10), **document tables' RLS forced** (§11.13, `V143_28`).
- **Dashboard** (§2): built alongside w2h (the merged app keeps w2h's record names with links, department filter incl. "No department", notices pager and milestone filters); from w2i it keeps the payroll bar opening that month's run (else the runs list filtered to the month) and top performers' department.
- **Attendance calendar** (§4): superseded by w2f (the trend flags real weekly-off days). The server-side rule is merged: own weekly offs, else the shift's (w2d), else the company's (w2i, HR Configuration), else Sat+Sun.
- **Employee workspace** (§7): the Goals tile counts open goals only.
- **Checked:** `e2e/recovery/live-w2i.mjs` (API-level, no browser; written, not run here). It calls every endpoint above as owner, HR, finance, manager and employee, checks the database, the refusals (403) and the day rules, and removes or restores what it touches. Unit tests: `AttendanceCalendarTest`, `CanonicalAttendanceRulesTest`, `AuditResourceNameTest`, `HiringAllCandidatesTest`, and `lettersView.test.ts` (vitest).
- **Still open from the leftovers:** the trend API's 31-day cap on the dashboard calendar (§2), real integrations (§11.14), deactivated geofence zones (retired with the Geofencing page, D3).
