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
