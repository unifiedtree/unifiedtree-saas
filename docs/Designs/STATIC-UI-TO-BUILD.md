# Redesign: what's static, what needs building

This file tracks the Claude Design redesign (`docs/Designs/UnifiedTree HRMS Prototype.html`) as it's built into the app. Every screen matches the design exactly. This file lists the parts that aren't fully backed by real data yet, and every place the build differs from the prototype (with the reason). Nothing from the design was removed.

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
