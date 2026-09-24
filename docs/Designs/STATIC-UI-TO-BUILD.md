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
