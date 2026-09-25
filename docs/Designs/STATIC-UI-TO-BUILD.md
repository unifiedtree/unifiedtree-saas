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
| Search field | Done | Opens the existing ⌘K search palette. |
| Notifications bell | Kept | The design has no notifications panel ("not designed yet"). The existing panel is kept, and the amber dot shows only when something is unread. |
| Profile button | Kept | The design goes straight to `/profile`. The app keeps its menu (My Profile, My Apps, Settings, **Sign out**). There's no other way to sign out. |
| Settings (gear) | Done | Same pattern as the design: the rail stays, the gear lights up, and the settings pages become tabs. The app lists all 10 real settings pages (the design showed 5). |
| Route tooltips ("→ /hrms/…") and the bottom-right "Prototype" pill | Not shipped | Navigation aids for the prototype only. Human-readable tooltips are kept. |
| Leaves added after the design (e.g. "Docs to Review" under Hiring) | Kept | Still in the menu. |
| Geofencing (`/hrms/attendance/geofencing`) | Kept, **decision needed** | The design moved branch geofences into Companies & Branches and has no Geofencing tab. The page is kept and reachable. Decide whether to retire it once Companies & Branches is built. |

## 2. Company Admin Dashboard (`/dashboard`): done

Checked live: `e2e/recovery/live-design-dashboard.mjs`, 12/12 (calendar, past-date view, publish and archive a notice, projects panel, tile drill-down, no page errors, no failed API calls).

| Item | Status | Detail |
|---|---|---|
| All tiles, charts, cards and lists | Done | Real data from the existing endpoints. Each card has its own loading, empty and error state. |
| Greeting | Done | The prototype always said "Good morning". It now follows the time of day (IST). |
| Chart axes | Done | The prototype had fixed axes (0–120 people, ₹42L–₹50L). They now scale to the real numbers. |
| Projects & Productivity card | Kept | The design shows a summary card. **Manage projects →** opens the existing project and task manager in a side panel, because `/projects` is still a placeholder and this is the only place to change task status. |
| Archiving a notice | Kept | Asks for confirmation first, as the old card did. The prototype archived immediately. |
| Activity feed: record name ("… for **Rahul Verma**") | Needs backend | `/v1/audit/events` returns the resource type and id but not its name. Each row shows the actor and the action, and links to Audit Logs rather than the record. |
| Top performers: department line | Needs backend | `/v1/admin/dashboard/performers` has no department. Only the review count is shown. |
| Dept Distribution: click a bar to filter the directory | Needs backend | `/v1/reports/headcount` rows have the department name but no id, so the click opens the unfiltered directory. |
| Milestones "View all →" (birthdays, anniversaries, retirements) | Needs backend | Opens `/hrms/employees?filter=birthday` etc., but the directory has no such filters yet. |
| Payroll chart: click a month | Needs backend | Opens `/hrms/payroll/runs?month=YYYY-MM`. The runs page doesn't filter by month yet. |
| Hiring stage rows → `/hrms/hiring?tab=candidates&stage=…` | To verify | Check the Hiring page applies the `stage` filter. |
| Company notices | Partial | Shows the latest 5, as in the design ("5 per page"). There's no pager, so older notices aren't reachable from the dashboard. |
| Date calendar colours | Partial | The trend API caps at 31 days, so only the last month is coloured. Early departures for past days show 0 (the trend API doesn't return them). Today's figures are exact. |
| Today's Absence / Not Marked, donut, "exceptions" | Changed | Same one-bucket-per-person numbers as Attendance & Time (`attendance/attendanceBuckets.ts`). Today, someone with no punch and no leave is **Not Marked**, and Absence stays 0 until the day is over. The donut and the exceptions count no longer count them twice (the API's "not marked" also contains the absent and people on leave). |
| Seats tile | Partial | Shown only to billing admins (Owner, Super Admin, Company Admin), and once the seats data has loaded. |
| Sections the viewer has no permission for | Partial | They show an empty state. The design's rule is to hide them. This only affects admin roles missing a specific permission. |
| Chart colours | Decision | The prototype's default "tones" palette (multi-colour) is used. The prototype also has an "emerald only" option, which is one switch (`chartPalette="emerald"`) if you prefer it. |

## 3. Companies & Branches (`/hrms/companies`): done

Checked live: `e2e/recovery/live-design-companies.mjs`, 10/10 (create a branch with a geofence, edit it and make it HQ, archive it, edit and restore the company, save the employee-ID format, no page errors, no failed API calls).

| Item | Status | Detail |
|---|---|---|
| Company picker, company card, statutory info, next employee ID | Done | Real company data plus the employee-ID format from HR configuration. |
| Add / edit company, save ID format | Done | Existing company and HR-configuration endpoints. Edits send every field as typed, so clearing a field (e.g. GSTIN) now saves the clear. |
| Branch cards/table, search and status/city filters | Done | Real branches. |
| Create / edit branch (4-step drawer), map pin, geofence | Done | Edit uses the existing `PUT /v1/hrms/branches/{id}` endpoint (it had no web hook before). The geofence saves through `PUT /v1/hrms/branches/{id}/geofence`. |
| Mark as headquarters | Done | The previous headquarters is switched off in the same save, matching the design's "Replaces X as the headquarters". **Backend follow-up:** enforce one HQ per company on the server so the two updates can't diverge. |
| Archive company / branch | Done | Confirmation dialog as designed. Archive is soft (employees keep their assignment). |
| Company description ("Product engineering and IT services.") | Needs backend | Companies have no description field. The card shows the design's own fallback, "No description yet." |
| Geofence without `org.geofence.write` | Partial | The branch still saves; the attendance area stays unchanged and the user is told why. |
| "Inactive" status filter | Partial | Archived branches aren't returned by the API, so this filter only shows branches marked inactive, not archived ones. |
| Employees links (company and branch) | Done | The Workforce Directory now opens pre-filtered from `?companyId=`, `?branchId=` and `?departmentId=` links. |
| Organization Setup's Companies / Branches tabs (`/hrms/organization`) | Kept | Still there, untouched. This page and those tabs manage the same records. |

## 4. Attendance & Time (`/hrms/att-analytics`, `/hrms/attendance`, `/hrms/shifts`): done

One designed page serves all three routes. Its own section bar (Analytics · Daily Tracking · Shifts & Overtime) replaces the shell's sub-tabs on these routes. Employees see only Daily Tracking (My Attendance, Regularization) and Shifts (My Shift). Container: `src/modules/hrms/attendance/AttendanceContainer.tsx`.

Checked live: `e2e/recovery/live-design-attendance.mjs`, 26/26. As HR it checks the section bar and tabs, that tiles match the table, the status filter, "Fix this day", that the who's-where breakdown adds up, the report link, and adding, editing and deleting a shift, plus the overtime "note required" check. As an employee it checks their tabs and sends a fix request, which HR then rejects. It also checks for no page errors and no failed API calls. Nothing irreversible is approved.

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
| Face match wording | Changed | The API gives a band (High / Medium / Low), never a percentage. The card says "partly sure", "Low match" and "Medium needed", and "Low-confidence punches need a person to check" replaces "under 85%". The backend's default match cut-off is 82% (configurable). |
| Late tile "After the 15-min grace time" | Changed | Uses the real grace when every shift shares one. Otherwise it reads "After each shift's grace time". |
| Calendar Sunday text "Only a few on-call people worked" | Changed | Shows the real count ("N people still checked in") or just "Sunday is the weekly off." |
| "Download report" / "Open the full report" | Changed | Open the Attendance Summary report for this month (`?company=&from=&to=`, which is what that page reads). The CSV download is on that page. |
| On-leave days in My Attendance | Changed | Approved leave is its own colour. The design's sample month had none, so the legend lists it only when a leave day exists. |
| Phone layout | Changed | The page column is capped at the screen width, so the section bar and tabs scroll sideways as intended instead of widening the page. |
| Face check: **Yes, it's …** / **Not them** | Needs backend | No API records an HR check on a face punch. Tapping says so, and the punch stays as recorded. With default settings nothing lands in "Needs a look": Low matches are rejected by the camera. |
| Face tab "Kiosk" column | Needs backend | Face events carry no device. The column shows Punch in or Punch out. |
| Face tab names | Partial | Events carry only the login id. Names come from the enrolment email matched to the directory. Unmatched rows show the email and don't open a profile. |
| **Proof (optional)** file on "Ask for a fix" | Needs backend | Shown switched off, marked "Coming soon". The API accepts a link (`attachmentUrl`) but has no upload. |
| Roster "Since" column | Needs backend | `/v1/team/schedule` returns no assignment start or joining date, so the column is blank. |
| Roster shift match | Partial | The schedule API returns the shift **name**, not its id, so two shifts with the same name would be confused. Backend: add `shiftPolicyId` (and `since`) to `/v1/team/schedule`. |
| Note field in the Change-shift drawer | Needs backend | The assign API takes no note, so it isn't saved. |
| Overtime: shift end, left at, reason | Needs backend | The overtime list returns only the date and minutes. These show a dash, and the card says "recorded automatically". |
| Overtime older than last month | Partial | The design has no month picker. Pending items from this month and last are listed. |
| Shift Requests "Already decided" (HR) | Needs backend | Only pending requests have an API. Employees still see their own history under My Shift. |
| Shift colour | Partial | Not stored: it's worked out from the start time, and night shifts are the moon. Picking **Night** saves the shift as NIGHT. The other colours are display only. |
| Break | Partial | Stored as working hours per day. Break = shift length minus working hours. |
| Past days' "came in" (trend, calendar) | Partial | A person who worked from home **and** was late or half-day is counted twice, because the trend API has no per-day checked-in total. Today is exact. |
| Weekly off on the calendar | Partial | The design greys out Sundays. The numbers already leave out each person's own week-offs (the API does that), but other week-off days still show as working days. |
| HR without the face-log permission | Partial | The Face tab shows its empty state. The design has no "no access" state for it. |
| Geofencing | Kept | Not in the design's section bar. Still at `/hrms/attendance/geofencing`, reachable from search (⌘K). See §1. |
| Old pages (`Attendance.tsx`, `AttendanceAnalytics.tsx`, `ShiftsAndOt.tsx` and their parts) | Removed | Replaced by the designed page. Manual entry, Muster roll, Geofencing and `/me/shift-change` are untouched. |

## 5. Payroll (`/hrms/payroll-dashboard`, `/hrms/salary-structure`, `/hrms/payroll/runs[/:id]`, `/hrms/payroll/settings`, `/hrms/pli`, `/hrms/advances`, `/hrms/bank-disbursement`): done

One designed page serves all eight routes, with its own section bar in place of the shell's sub-tabs. Container: `src/modules/hrms/payroll/PayrollContainer.tsx`.

Checked live: `e2e/recovery/live-design-payroll.mjs`, 29/29. It covers:
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
| PLI banner | Changed | The design said PLI is added to net pay automatically. This backend doesn't do that, so the banner says bonuses are paid out as awards, and **Manage awards →** opens the existing awards manager (create, approve, pay). |
| Advances statuses and actions | Changed | The API's statuses map to Pending approval / Approved · to pay out / Active deduction / Repaid / Closed / Rejected. **Issue advance** sends a request for the signed-in person (see below). |
| Salary drawer | Changed | A new structure uses the design's split: Basic 50%, HRA 40% of basic, ₹1,600 conveyance from ₹20,000, special allowance the rest. Editing an existing structure scales that person's own split, so a custom split is never overwritten. The preview uses the real PF, ESI and PT settings. There is no ₹10,000 minimum, because that isn't a rule in the system. |
| Dashboard "Total payroll cost" | Changed | The gross of this month's run, so it matches the chart and the runs list. The KPI endpoint's figure also includes employer contributions. |
| Employees without the admin view | Kept | `/hrms/pli` and `/hrms/advances` still show their own self-service pages (My Incentives; My Advances / Request). |
| "TDS this month" tile | Needs backend | Payroll doesn't calculate TDS. The tile shows a dash and says so. |
| Statutory dues | Partial | Comes from Compliance → Statutory Filings, a ledger filled in by hand. It isn't computed from payroll. |
| Pay breakdown by component | Partial | Added up from the payslips for runs of up to 60 people. Bigger runs show totals only, pending a per-component totals endpoint. |
| Run details "Pay date" / "Working days", activity names | Needs backend | The API doesn't keep them, so they show a dash. Activity lines show the time only. |
| Salary Structure **Export** | Needs backend | There's no endpoint that lists every structure. The button is off, marked "Coming soon". |
| **Bulk revise CTC** | Needs backend | The form shows. **Apply revision** is off and marked "Coming soon". |
| **Issue advance** for someone else | Needs backend | Advances are self-service in the API. The form requests one for yourself; for anyone else it explains that. |
| Advance "Loan type" | Partial | The API has no loan types, so the request's reason is shown. The first deduction is always the month after payout (API rule). |
| PLI people and "Bonus per person" | Partial | Headcount is known for employee or department targets. For others the amount is the whole pool. PLI isn't paid through payroll. |
| Payroll cycle days, processing day, LWF, PF/ESI codes | Partial | Saved, but not used by payroll yet: runs cover the calendar month. The cycle card's switch stays on (the API has no switch for it). |
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

| Item | Status | Detail |
|---|---|---|
| Overview, Employee Master, Companies, Branches, Departments, Designations, Shift Rules, Leave Rules, Policy Documents, Salary Components, Statutory Settings | Done | Real data and real saves. Headcounts come from the employee list, because the API's cached counts are never updated. |
| Classification Rules | Changed | Backed by **employment types**, which are what employee records link to (by code). Probation and notice show the company-wide HR configuration. PF/ESI shows "Set per employee", because it lives on each salary structure. The separate `/v1/hrms/classifications` API has no screen, and its list refuses Owner/Admin by role name, so it isn't used. Built-in types can't be edited, as on the old page. |
| Contractor Master | Partial | Add, End contract and Export work. **Edit agency**, **Renew licence** and **Reactivate** are off ("Coming soon"): the API has no update or restore. Service, deployment sites, worker count and licence date aren't stored, so the form shows those fields switched off and the cards show a dash. |
| Grades & Bands | Needs backend | Grades are saved (level and name). **Pay bands (min/max CTC) aren't stored**, so the band bars are empty, "Band not set yet" shows, and the form's band fields are off. Deactivate was added to the grade menu, matching the old page. |
| Employee add / edit | Done | Creates with the fields the design asks for, assigns the shift, and sends the login invitation (as the old wizard did). The next employee code comes from the company's code settings. Company can't be changed on edit. The full record page (`/hrms/employees/:id`) stays and has a **Full record** button in the profile. |
| Bulk status change | Changed | "Mark as active" confirms people on probation and cancels notice for people serving it. "Mark as probation" changes active people only; people on notice are left alone. The toast counts only the people who changed. |
| Start exit | Done | A last working day of today or earlier marks the person exited; a later one starts their notice. |
| Import / Export | Done | **Import** opens the existing bulk import. **Export** downloads the rows shown, with the same columns and spreadsheet-formula guard as the server export. |
| Shift Rules | Partial | Name, type, times, grace, hours and overtime rate are saved. Shift code, flexible core hours and per-shift weekly offs aren't stored ("Coming soon"). **Duplicate** opens a filled "Add shift" form, because shifts can't be parked as inactive. Overtime copy says the rate is recorded, not paid, which is the business rule. An overnight shift is saved as a Night shift. |
| Leave Rules | Partial | Name, code, category, quota (must be more than 0), paid and carry-forward cap are saved. Accrual shows "Credited upfront", which is what the balance job does. Monthly/quarterly accrual, encashment and per-classification "Applies to" aren't in the API ("Coming soon"). The year-end carry-forward move isn't automated; the tip says so. |
| Policy Documents | Partial | Publish, save as draft, edit, new version (a new draft), archive and restore all work. **Remind**, **Email everyone when published** and optional acknowledgement aren't in the API ("Coming soon"). **Discard draft** archives the draft, because policies can't be deleted. |
| Salary Components | Partial | Add, edit and delete (for components that aren't built-in or in use) work. Computation shows the backend's types: Fixed, % of Basic, % of Gross, Formula, Statutory. Statutory lines show the real PF/ESI rates. Fixed amounts, "Partly exempt", **Show on payslip** and **Deactivate** aren't in the API ("Coming soon"). The CTC card shows the split new salary structures use. |
| Statutory Settings | Partial | The switches save the payroll settings (the same ones as Payroll Settings). PT shows the configured state's real slabs. **LWF is saved but payroll doesn't deduct it** (the card says so). PT and LWF registration numbers and PF admin charges aren't stored, so they show a dash. |
| Companies | Partial | The head office comes from the branch marked HQ. TAN and "since" aren't stored ("Coming soon" on the form). |
| Branches | Changed | Only "Head office" is recorded as a type, so every other branch shows "Branch". Plant, warehouse and other types are "Coming soon". Deactivated branches leave the list (the API lists active ones only). |
| Departments | Partial | Rename, code, icon, head and archive work. A department can't be moved under another after it's created (no API). |
| Designations | Partial | Designations have no code in the API, so the code line is empty. The grade is free text; one that matches no grade shows as a chip. |
| Loading / error / no access | Kept | The design had no such states. Each page waits for its own data and shows a loading card, an error card with **Try again**, or "You don't have access". |

**Backend gaps found while building Master** (to build; not built here):
- Grade pay bands (min/max CTC) and a link from designation to grade by id. The grade is free text today.
- Agencies:
  - An update and restore endpoint.
  - Licence expiry, service, deployment sites and worker counts (`active_workers_count` is never written).
  - A link from contract workers to agencies.
- Classifications API: `GET` is gated by role name (Owner/Admin get 403), and there's no update endpoint.
- Components:
  - Can't be deactivated (`is_active` isn't updatable).
  - No fixed amounts: `percent_value` is `NUMERIC(6,3)`.
  - No "show on payslip" flag.
  - `POST` silently ignores a duplicate code.
- Leave types: accrual frequency and encashable exist in the database but not in the API; there is no year-end carry-forward job; `annualEntitlement` must be more than 0.
- Shifts:
  - `GET /v1/shifts` re-creates the four default shifts on every read, so deleting one of them is undone.
  - No code, core hours or weekly offs.
- Departments: no endpoint to change the parent; `branchIds` on create is ignored.
- Policies: no delete, no reminders, no email on publish.
- Cached counts (company, branch and department `employeeCount`, designation `headcount`) are never maintained.
- Payroll: LWF, cycle days and PF/ESI establishment codes are stored but not used by runs.

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
| Leave and Expenses tabs | Needs backend | Shown, as in the design, with a note and a link to the Leave or Expense centre. The API only returns leave and claims for the signed-in person. It needs `GET /v1/leave/employees/{id}/balances` / `…/requests` and `GET /v1/expense/employees/{id}/claims`. |
| Goals tile | Partial | Counts all goals and KPIs; the API has no "active" filter. |
| Onboarding "Offer accepted / Hiring manager / Recruiter / Source / Buddy" | Needs backend | The saved record doesn't hold these; the real saved details are shown instead. |
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
| Default probation length | Saved, not applied | Nothing sets a new hire's probation end date from it. The date comes from the employee form or **Extend**. *Needs:* set `probation_end_date = date_of_joining + N months` on create when none is given. |
| Default notice period | Applied (frontend) | Pre-fills the last working day when starting an exit in Employee Master. |
| Retirement age | Saved, not applied | Nothing is scheduled from it. *Needs:* a retirement-due list or alert. |
| Work week (start day, weekly offs) | Partly applied | The leave form preview and the leave calendar use the weekly offs. **Bug (backend):** `LeaveService.isWeekend` hard-codes Saturday and Sunday, so on a 6-day or Friday–Saturday week the days deducted differ from the preview. It should read `weekend_days` for the person's company. Attendance uses each person's own `weekly_off_days`. |
| Late arrival (company grace, automatic deduction) | Saved, not applied | Late comes from each shift's start plus the shift's own grace, or 09:30 with no shift. Loss of pay for late marks comes from Payroll Settings → late-mark threshold (`PayrollRunService`). *Needs:* either wire these in or remove them. |
| Attendance rules (geofencing on mobile, work from home) | Saved, not applied | Blocking check-ins outside the zone is one server-wide setting (`hrms.attendance.geofence-enforce`, on in production). Work-from-home requests depend only on the `wfh.request.self` permission. *Needs:* read these per company in `AttendanceController.checkIn` and `WfhController`. |
| Fiscal year | Saved, not applied | Shown and saved, but nothing reads this copy. The company record has its own fiscal-year field (Companies page, `hrms.companies.fiscal_year_start`). *Needs:* keep one of the two. |
| Profile (`/profile`) | Done | Photo and contact, Employment, Personal details, Approval delegation, My documents and Notifications, each as a section card. Name and phone save through the unsaved bar, with checks: the name can't be blank and the phone allows digits, spaces, + and - only. The photo uploads on its own. A `#st-<section>` link opens at that section. |
| Profile → notification switches (email, push) | Saved, not applied | Saved to `auth.user_credentials.notification_preferences`, but nothing that sends email or alerts reads them. The page says so. *Needs:* the senders check them. |
| Workspace Settings → Profile (`/settings/profile`) | Read-only | No endpoint updates the account or the workspace, so it shows values and an email address to contact, as before. |
| Workspace Settings → Branding | Done | Logo upload, replace and open, with the same server checks and messages. |
| Workspace Settings → Security | Partly | Password reset email works. **Two-factor** and **Active sessions** show "Coming soon". *Needs:* TOTP enrolment (the `is_mfa_enabled` flag exists; enrolment doesn't), and a session list with sign-out. |
| Workspace Settings → Notifications | Coming soon | Lists what reaches admins today. Email and in-app choices show "Coming soon". *Needs:* a per-user preferences endpoint and senders that read it. |
| Workspace Settings → Billing & Plan | Done / Coming soon | The plan comes from `/v1/workspace/plan/current`. **Invoices** shows "Coming soon" and needs Razorpay's invoice API. Locally, the demo workspace has no `platform.account_workspaces` row, so this endpoint answers 403 and the page shows its load-error note. That's a gap in the test data, not a code bug. |
| Workspace Settings → Integrations | Coming soon | Slack, GitHub, Jira, Zapier, Stripe and Salesforce each show "Coming soon"; none is built. |
| Workspace Settings → Document types | Done | The existing add, edit and deactivate list, inside a section card. |
| Workspace Settings → Danger zone | By request | Export, reset and delete each open an email to the team, which confirms before acting. *Needs:* real endpoints with a typed-name confirmation. |

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
  - a print-ready snapshot
  - the "Recent downloads" list
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
| Export → Dashboard snapshot (PDF) | Done (browser) | Opens a print-ready page; the browser's "Save as PDF" writes the file. *Needs:* server-side PDF for a direct download and for scheduled emails. |
| Export → Excel and CSV; chart PNGs | Done | Excel and PNG are built in the browser from the numbers on screen. Report CSVs come from the server routes. |
| Recent downloads (Reports Center) | Partial | Lists downloads made in this browser. *Needs:* a server export log (who downloaded what, when) for a shared, auditable history. |
| Attrition split (resigned / terminated / other) | Partial | The exit flow marks people `EXITED` without saying whether they resigned, so most exits show as "other". *Needs:* an exit type on the exit flow. |
| Headcount on a past date | Partial | Who was employed is correct for any date. The active/notice/probation split uses today's status. *Needs:* status history. |
| "No department" click | Partial | Opens the company's whole directory; the directory has no "no department" filter. *Needs:* that filter. |
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
- *Payroll* also treats Saturday and Sunday as off for everyone (`PayrollRunService`, lines 966 and 985). Changing how pay is calculated needs a decision first, so it's left as is.
- The alternate `CanonicalAttendanceService` (only used by the `canonical-jdbc-api` profile) has the same "today is absent" and Sat/Sun rules.
- A company that had only the old "Standard 9-6" shift no longer gets "General" added automatically. It can be added in Shift Rules.

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
- **Payslips:** this year's take-home, gross and deductions as tiles, then one row per month with status and PDF. *Needs backend:* there's no API for an employee's own payslip lines (only the list and the PDF), so the breakdown is only in the PDF. `GET /v1/payroll/payslips/me/{runId}` would allow showing it in the design's payslip drawer.
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
- **Static, noted:** receipts can't be attached to claims yet. The line items have a Receipt column but there's no upload; the Submit form now says so. *Needs:* receipt upload on expense items.
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
- **Static / to build:**
  - Dragging cards between stages. For now, the stage is changed with the select on each card.
  - Interview scheduling and scorecards. The stage list has interview stages, but there's no calendar or feedback record behind them.
- **Checked live:** `live-candidate-conversion` 13/13 and `live-offers-browser`, which passed.

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
- **Static / to build:**
  - Reordering template tasks. The API has no reorder endpoint; order is fixed when a task is added.
  - Picking the owner role from a list. It is typed in for now.
  - A "my assets" view for employees. The asset API is company-wide and only for asset readers, so employees don't see what they hold.
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
- **Static / to build:**
  - Programs have no detail page or edit. Title, dates and seats can't be changed after creation; only the status can.
  - There's no self-assessment of skills. Employees can see their skills but not propose changes.
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
- **Static / to build:** deactivated zones can't be seen or restored, because the list endpoint returns active zones only.
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
- **Checked (security):** the review queue's SQL has no tenant filter. It relies on row-level security, which applies because the app connects as `ut_app`, not the table owner, so there's no leak. RLS isn't forced on `document_mgmt` tables, so this would break if the app ever connected as the owner. Noted, not changed.
- **Static / to build:**
  - Documents can't be edited after they're stored. The only fix is to delete and add again.
  - There's no bulk upload.
  - The Letters pages are separate routes linked from the Hiring sub-navigation; there's no single "Letters" hub.
- **Fixed (tests):** `letters-admin-live.mjs` left its template and letter behind. It now removes them.
- **Checked live:** `live-design-documents.mjs` 19/19 (HR adds by link → employee sees it → HR deletes; pending card, View file, reject with reason, verify; every letters page; with cleanup) and `letters-admin-live.mjs` (passes).

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
  - **Static / to build:** templates are saved, but nothing in the sending path reads them. Notifications still use their built-in wording, and the page now says so in an amber note. Using them needs the sender to look up the company's active template by event key and channel.
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
- **Added (Audit logs):** "Export this page" writes the rows on screen to a CSV and records it in the Reports Center. The page says it's one page only.
  - **Static / to build:** there's no server export of the full trail.
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
- **Static / to build (performance):**
  - Nothing shows the per-employee performance directory; the endpoint works and is now scoped.
  - Employees can't see their KPI's progress history, only current against target.
  - A review doesn't show the reviewee's KPIs while it's being written.
