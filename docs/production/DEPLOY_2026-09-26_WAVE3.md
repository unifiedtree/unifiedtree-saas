# Wave 3 deploy notes (26 Sep 2026)

**Who this is for:** the teammate deploying `main`, and the owner checking the work.
**What ships:** everything merged from branch `wave-3-ui` on 26 Sep: 10 features across the web app and backend, one database migration, and a separate mobile branch (not merged, not published).

> **To deploy, follow `DEPLOY_2026-09-26.md`.** It is the one checklist: database (V140 → V143_40), backend, web app and a smoke test per role. This page is background: what wave 3 changed, the phone test and the choices made.
>
> **Updated 26 Sep, later that day:**
> - **The settings hub was undone at the client's request.** Every setting is back in its original place, as before 26 Sep (§4). Only the hub's addresses remain, as redirects.
> - **Left menu fix:** the rail item you click stays lit. Leave no longer lights Me for managers (§4).
> - Every other wave 3 change stays as described here.

---

## 1. Database: one migration, `V143_40__assisted_face_punch.sql`

Production has Flyway off, so apply it by hand, **after V143_34**, as a superuser (the table has row-level security). The file is re-runnable (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

It adds:
- the table `attendance.assisted_punches` ("punched by": who punched someone in or out with that person's face). It has an RLS policy and grants for `ut_app`. It is read and written with JDBC only; no Java entity maps it.
- two permissions, shown in Roles & permissions under Attendance:

  | Permission | Meaning | Given to |
  |---|---|---|
  | `attendance.assisted_punch.team` | Punch in/out for their team with a face scan | DEPT_MANAGER, MANAGER, OWNER, SUPER_ADMIN |
  | `attendance.assisted_punch.any` | Punch in/out for anyone with a face scan | HR_MANAGER, ADMIN, OWNER, SUPER_ADMIN |

**It is safe in either order.**
- If the backend deploys first, nobody holds the new permissions yet. So the assisted-punch endpoints answer 403, the mobile entry stays hidden, and the web's "Punched by" labels simply don't appear. Nothing else is affected.
- The startup check (`OwnerPermissionInvariantCheck`) passes either way, because OWNER is granted both permissions in the same file.

Check it applied:
```sql
SELECT to_regclass('attendance.assisted_punches');                       -- not null
SELECT count(*) FROM rbac.role_permissions rp JOIN rbac.roles r ON r.id = rp.role_id
 WHERE r.tenant_id IS NULL AND rp.permission_code LIKE 'attendance.assisted_punch.%';  -- 8
```

No other wave-3 change needs the database. Every other feature uses existing tables, and adds only optional API parameters or read-only endpoints.

## 2. Backend and frontend

- **Backend:** it auto-deploys on push (Cloud Run). No new environment variables.
- **Web face enrollment** uses the same face worker as the mobile app (`UNIFIEDTREE_FACE_WORKER_URL`). Browsers only allow the camera on https, which Vercel already serves.
- **Frontend:** it deploys on Vercel as usual. Nothing new to configure.
- **Backward compatible:** every changed endpoint behaves exactly as before when the new optional parameters are left out, so the phone app keeps working unchanged.

## 3. Mobile: assisted face punch (separate repo, not merged)

- **Where:** repo `SRC-ORGanisation/attendance`, branch **`wave-3/assisted-face-punch`**.
- **State:** pushed only. Not merged, and nothing published through EAS or OTA.
- **Open a PR:** https://github.com/SRC-ORGanisation/attendance/pull/new/wave-3/assisted-face-punch
- **Needs:** a build pointed at a backend that has V143_40. After the migration, people must sign out and back in once to see the new entry.

**5-minute phone test.** You need a manager login, one team member who has already enrolled their face, and both of you at the office.
1. Sign in as the manager. Home shows **Punch for team member**. An employee login does not show it.
2. Open it. Only your team is listed, with badges (Not punched in / No face enrolled / In at 09:14). Search narrows the list.
3. Tap the enrolled person and scan **their** face. You see "Punched in <name> at hh:mm, by you".
4. On the web, open Attendance → Daily Tracking. On a working day, their row says "Punched by <you>", and the day drawer shows "Punched by: <you> (in)".
5. Punch them out again, but scan **your own** face. You see "Face didn't match" and nothing is recorded. Scan theirs and they are punched out.
6. Tap someone with no face enrolled. You get an explanation and no camera.
7. Try from outside the office geofence. You see "Outside the work area".
8. In Roles & permissions, take "Punch in/out for their team…" away from Dept Manager. The manager signs in again and the entry is gone.
9. Sign in as HR. The list shows everyone in the company.

## 4. What changed, for the smoke test

For each area: what to do, then what you should see.

- **Calendar (every date field):**
  - Do: open any date field.
  - See: day, month and year views, the "September ▾ 2026 ▾" jump chips, presets (Today, Yesterday…), full keyboard support, and a bottom sheet on phones.
  - Range and month pickers exist where they fit.
  - Time fields (for example shift start/end) are still the browser's time boxes.
- **Admin dashboard, date:**
  - Do: pick a past date, including one in an earlier year.
  - See: every card shows that day. The date stays in the URL (`?date=`).
  - Seats have no history, so that card says "As of today". Upcoming milestones counts from today, and the banner says so.
  - The headcount export and "View reports" follow the date.
- **Attendance Analytics:**
  - Do: pick a month and year (`?month=`).
  - See: the tiles, charts, calendar, late marks and the report link follow that month. Future months are blocked.
- **Upcoming milestones:**
  - Do: open any of the three lists.
  - See: each has This month, Next month, Next 3 months, Next 6 months, This year, and a custom From/To range (up to 12 months). "View all" follows the range.
  - For privacy, a list only reaches as far as the old windows did (birthdays and anniversaries within 12 months of today, retirements up to 5 years ahead).
- **Global search (top bar):**
  - Do: type at least 2 letters.
  - See: pages, people and records (leave, claims, payslips, documents, letters, candidates, offers, job openings, policies), each limited by permission on the server (`GET /v1/search/global`).
  - Choosing a result opens that page with the search filled in.
  - The old palette is now **Advanced search** (link at the bottom of the results, or Ctrl/⌘K).
- **Settings: the hub was undone on 26 Sep, at the client's request.** Everything is back in its original place, exactly as before 26 Sep:
  - **HR Setup** at the bottom of the HRMS rail: HR Configuration, Notification Templates, Integrations.
  - **Master → Rules & Policies** (Shift Rules, Leave Rules, Policy Documents) and **Master → Payroll Configuration** (Salary Components, Statutory Settings).
  - **Payroll → Payroll Settings**; **Expenses → Policies**; Roles & Permissions at `/roles`; Document Types at `/settings/documents`.
  - The header gear opens Settings again, and the profile menu says **Settings**.
  - The "HRMS settings" page, the Apps page's **Workspace settings** button and the **Settings** link under the HRMS tile are gone.
  - The hub's addresses redirect to the original pages and keep their query and `#section`. For example `/hrms/settings/shift-rules` → `/hrms/master/shift-rules` and `/hrms/settings/roles` → `/roles`. The full list is in `DEPLOY_2026-09-26.md` §9.
- **Left menu (added 26 Sep, after wave 3):**
  - Do: as a department manager, click **Leave** in the rail. Then click **Me** and its **Leave** tab.
  - See: Leave → **Leave** stays lit (it used to light Me). Me → Leave keeps **Me** lit, with Me's tabs. A refresh keeps it.
  - A link, a search result, a dashboard card or Back lights the page's own item. Signing out forgets the click.
  - Routes, targets and who sees what are unchanged. Test: `e2e/recovery/live-rail-highlight.mjs`.
- **Adding an employee:**
  - Do: add someone from Employee Master → Add employee, or through the onboarding wizard.
  - See: an **Access** step with roles (Employee is always on) and single permissions by module (search, select-all, added/removed shown).
  - Only people who can manage users or overrides see it (today OWNER, ADMIN, SUPER_ADMIN).
  - In onboarding it applies only when "Send their login invite" is switched on (off by default).
- **Face enrollment on the web:**
  - Profile → Face enrollment: anyone can enroll or re-enroll their own face.
  - HR/Admin can enroll or re-enroll anyone from the employee record (existing permission `attendance.face.admin.reset`).
- **Greeting:** the greeting uses the first name, or the full name when the first name has fewer than 2 letters ("S." → "S. Kumar").
- **My Attendance:** hidden for Owner, Admin and Super admin only. `?tab=my` opens Daily Logs for them. The backend is unchanged.

## 5. Choices made while the owner was asleep (the safest option each time)

- **Search:**
  - Leave, documents and expenses results open that person's workspace tab; those list pages have no search box.
  - A job-offer result opens the Offers tab, not the single offer.
- **Access step:**
  - Onboarding doesn't send the login invite by default, as before, so access applies only when the switch is on.
  - If the email already had a login (the same person in another company), that login's access is left alone, and the admin is told to set it in Users & access.
- **Settings:** no longer applies. The hub was undone on 26 Sep (§4), so every setting is where it was before.
- **Face enrollment:**
  - It reuses the phone's flow and the server's face worker. No face model runs in the browser.
  - Self re-enroll is still blocked for the lock's cooldown (existing server rule, 30 min); HR can unlock sooner.
- **Assisted punch:**
  - The face is checked against the person's login enrollment.
  - Failed scans count toward that person's own lockout (5 in a row, 30 min).
  - Night shifts: someone punched in yesterday evening can be punched out after midnight, within the same 20 hours as a self punch-out.

## 6. Found on the way, not fixed (outside this wave's scope)

- **Reset face enrollment** (employee record) sends the employee id to an endpoint keyed by login id. For invited employees it probably resets nothing but still shows success.
  - Workaround: use the new **Re-enroll face**.
  - Fix: add `POST /v1/attendance/face/admin/employees/{employeeId}/reset` (`FaceService.requireLoginFor`).
- **Daily Logs** leaves out anyone whose weekly off is the chosen day, even when they punched in.
- **Muster roll:** the date box spans the whole toolbar row. This is an existing CSS order issue (`.ut-input { width:100% }` after the Tailwind utilities).
- **My workspace (`/me`)** still shows admins their own month of attendance. Only "My Attendance" was asked to be hidden. The client should decide.
- **Leave → Leave types** can still be edited there as well as in Master → Rules & Policies → Leave Rules. This is older duplication; employees read that tab.
- **Pre-existing failing live tests:** 29 checks and 4 scripts already failed on `main` before this wave (list in the wave-3 notes in `docs/Designs/STATIC-UI-TO-BUILD.md` §11.20). They are stale tests after the redesign, not new breakage.
