# HRMS build backlog: what's still static, and how to finish it end to end

**Who this is for:** the engineers finishing the HRMS after the 25 Sep redesign.
**Where it comes from:** every "Needs backend", "Saved, not applied", "Coming soon" and "Static / to build" note in `docs/Designs/STATIC-UI-TO-BUILD.md` (§ numbers below point there), consolidated and prioritised.

Every item below is already visible in the UI, either switched off with "Coming soon" or explained in a note. Nothing was removed. Finishing an item means: build the backend, switch the UI on, remove the "Coming soon"/note, and add a live test under `apps/platform/e2e/recovery/` that cleans up after itself.

Priorities:
- **P0**: the client will hit it in normal use, or a number is wrong. Do these first.
- **P1**: admin features that are visibly off.
- **P2**: polish.

---

## Decisions needed before building

| # | Question | Where | Notes |
|---|---|---|---|
| D1 | Should payroll use each company's weekly off days? | `PayrollRunService` ~lines 966 and 985 hard-code Saturday + Sunday | Leave already uses the company's work week (§10 #2). Pay would change for 6-day and Fri–Sat companies, so get sign-off. |
| D2 | Which fiscal year is the real one? | HR Configuration's fiscal year vs `hrms.companies.fiscal_year_start` | Keep one and read it everywhere (§8). |
| D3 | Retire the Geofencing page? | `/hrms/attendance/geofencing` vs the branch geofence in Companies & Branches | Two places set punch zones (§1, §4). |
| D4 | Pay PLI through payroll? | PLI is paid as separate awards today (§5) | If yes, add approved awards to the run's earnings. |

---

## P0: finish first

**P0-1 Payroll weekly offs** (after D1)
- *Now:* runs count Sat/Sun as off for everyone.
- *Build:* read `settings.hr_configuration.weekend_days` per company, like `LeaveService.resolveOffDays`.
- *Done when:* a 6-day-week company's run matches the attendance days.

**P0-2 Apply the HR configuration settings that are only saved** (§8)
- Default probation length: set `probation_end_date = date_of_joining + N months` on employee create when none is given.
- Late arrival (company grace, automatic deduction): wire it into the late-mark and LOP logic, or remove the fields.
- Attendance rules (geofence on mobile, WFH allowed): read them per company in `AttendanceController.checkIn` and `WfhController`.
- Retirement age: a "retirement due" list or alert.
- *Done when:* each switch changes behaviour, and the page's "saved, not applied" notes are gone.

**P0-3 Notification templates are used** (§11.14)
- *Now:* stored in `notiftemplate_mgmt.notification_templates`; senders use built-in text.
- *Build:* in the mail and in-app senders, look up the company's active template by `event_key` + channel, render `{{placeholders}}`, and fall back to the built-in text.
- *Also:* publish the list of event keys the senders use, so admins know what to type.
- *Done when:* editing a template changes the email or in-app text; the amber note is removed.

**P0-4 Notification preferences are honoured** (§8)
- *Now:* Profile and Workspace switches are saved to `auth.user_credentials.notification_preferences` but ignored.
- *Build:* senders check them.
- *Done when:* switching email off stops emails for that user.

**P0-5 File uploads that are placeholders**
- Expense receipts (§11.3): upload on expense items (same R2 storage as documents); show and download from the claim.
- Regularization proof (§4): upload and store its URL as `attachmentUrl`; show it on the approval card.
- *Done when:* the "Coming soon" and "can't attach" notes are gone and the files open for the approver.

**P0-6 Payslip breakdown for the employee** (§11.2)
- *Build:* `GET /v1/payroll/payslips/me/{runId}` returning the lines.
- *UI:* open the design's payslip drawer from `/me/payslips`.

**P0-7 Leave and Expenses tabs in the employee workspace** (§7)
- *Build:* `GET /v1/leave/employees/{id}/balances`, `…/requests` and `GET /v1/expense/employees/{id}/claims`, gated on the HR permissions.
- *Done when:* HR sees another person's leave and claims on their record.

**P0-8 Record the exit type** (§9)
- *Now:* exits are marked `EXITED` without a type, so attrition shows most exits as "other".
- *Build:* resignation / termination / other on the exit flow (UI + column); reports read it.

**P0-9 Enforce one headquarters per company on the server** (§3)
- *Now:* the UI switches off the old HQ in a second call.
- *Build:* a unique rule or transactional swap in the branch service.

**P0-10 Face punch review** (§4)
- *Build:* an API for HR to confirm or reject a low-confidence face punch ("Yes, it's …" / "Not them"), recorded on the event.

---

## P1: admin features that are switched off

**Master data** (§6)
- Grade pay bands (min/max CTC), and designation → grade by id (it's free text today).
- Contractors: update and restore endpoints; licence expiry, service, deployment sites, worker count; link contract workers to agencies.
- Classifications API: permission-based `GET` and an update endpoint.
- Salary components: deactivate, fixed amounts (`percent_value` is `NUMERIC(6,3)`), "show on payslip".
- Leave types: accrual frequency and encashment in the API; a year-end carry-forward job.
- Shifts: shift code, flexible core hours, weekly offs per shift.
- Departments: change parent; honour `branchIds` on create.
- Policies: delete, reminders, email on publish, optional acknowledgement.
- Companies: TAN, "since", description.
- Branch types (plant, warehouse…).

**Payroll** (§5)
- TDS calculation.
- Statutory dues computed from payroll (not the hand-filled ledger).
- LWF deduction.
- Payroll cycle days (not just calendar months).
- Run "Pay date" / "Working days" and activity names.
- Per-component totals for runs over 60 people.

**Attendance** (§4)
- Overtime details (shift end, left at, reason).
- Shift requests "Already decided" list for HR.
- Change-shift note.
- `/v1/team/schedule` with `shiftPolicyId` and `since`.
- Face events with the kiosk / device.
- Per-day checked-in totals for past days (removes the WFH + late double count).

**Reports** (§9)
- Server-side PDF export (direct download, scheduled emails).
- A server export log (who downloaded what, when).
- Status history (headcount split on past dates).
- A "no department" directory filter.

**Workspace settings** (§8)
- Two-factor (TOTP enrolment; `is_mfa_enabled` exists) and the active sessions list.
- Per-user notification preferences endpoint (see P0-4).
- Invoices (Razorpay).
- Danger-zone endpoints (export, reset, delete, with a typed-name confirmation).
- Account and workspace profile update.

**Audit logs** (§11.15)
- Full server export (CSV) of the filtered trail. Today only the visible page exports.

**Documents and letters** (§11.13)
- Edit a stored document.
- Bulk upload.

**Onboarding** (§11.8)
- Reorder template tasks.
- Owner role picked from a list.
- A "my assets" view for employees.

**Performance and Learning** (§11.10, §11.17)
- UI for the per-employee performance directory (the endpoint works and is team-scoped).
- KPI progress history for the employee.
- Show the reviewee's KPIs while writing a review.
- Program detail / edit (title, dates, seats).
- Skill self-assessment.

---

## P2: polish

- **Dashboard** (§2)
  - Record names in the activity feed (the audit API returns only the type and id).
  - Department on top performers.
  - Clicking a department bar filters the directory (headcount rows need the department id; the API now returns `department_id`, so wire it).
  - Milestones "View all" filters.
  - Month filter on payroll runs.
  - A notices pager.
- **Geofencing**: show and restore deactivated zones (the list API returns active zones only).
- **Integrations**: real connections (OAuth, keys, sync). Today it's a register only, and the page says so.
- **Letters**: one "Letters" hub instead of three routes.
- **Old gaps that are low risk**
  - `CanonicalAttendanceService` (only used by the `canonical-jdbc-api` profile) still has the old "today is absent" and Sat/Sun rules.
  - Documents RLS isn't FORCEd on `document_mgmt` tables (safe while the app connects as `ut_app`).

---

## How to work an item

1. Read its § in `STATIC-UI-TO-BUILD.md`: it says exactly what the UI shows today and why.
2. Build the backend. Add a migration as `V14x__…sql`, idempotent. **Grant any new permission to OWNER** too, or the app won't start (`OwnerPermissionInvariantCheck`). Add unit tests.
3. Switch the UI on. The pages use `src/design/module/ModuleKit.tsx`: keep using its parts.
4. Write a live test in `apps/platform/e2e/recovery/` against the local recovery server. Make it remove everything it creates.
5. Update `STATIC-UI-TO-BUILD.md` (mark it done) and this file (delete the line).
