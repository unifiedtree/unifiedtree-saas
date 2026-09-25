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

No open decisions (D1-D4 were settled on 25 Sep and built in wave 1).

---

## P0: finish first

All P0 items are done (wave 1).

---

## P1: admin features that are switched off

**Master data** (§6)
- Grade pay bands (min/max CTC), and designation → grade by id (it's free text today).
- Contractors: update and restore endpoints; licence expiry, service, deployment sites, worker count; link contract workers to agencies.
- Classifications API: permission-based `GET` and an update endpoint.
- Leave types: accrual frequency and encashment in the API; a year-end carry-forward job.
- Shifts: shift code, flexible core hours, weekly offs per shift.
- Departments: change parent; honour `branchIds` on create.
- Policies: delete, reminders, email on publish, optional acknowledgement.
- Companies: TAN, "since", description.
- Branch types (plant, warehouse…).

**Payroll** (§5)
- Bulk revise CTC ("Apply revision").
- Export every salary structure.
- Issue an advance for someone else.
- TDS calculation.

**Attendance** (§4)
- Overtime details (shift end, left at, reason).
- Shift requests "Already decided" list for HR.
- Change-shift note.
- `/v1/team/schedule` with `shiftPolicyId` and `since`.
- Face events with the kiosk / device.

**Reports** (§9)
- Server-side PDF export (direct download, scheduled emails).
- A server export log (who downloaded what, when).
- Status history (headcount split on past dates).
- A "no department" directory filter.

**Workspace settings** (§8)
- Invoices (Razorpay).

**Audit logs** (§11.15)
- Full server export (CSV) of the filtered trail. Today only the visible page exports.

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
- **Integrations**: real connections (OAuth, keys, sync). Today it's a register only, and the page says so.
- **Letters**: one "Letters" hub instead of three routes.
- **Old gaps that are low risk**
  - `CanonicalAttendanceService` (only used by the `canonical-jdbc-api` profile) still has the old "today is absent" and Sat/Sun rules.

---

## How to work an item

1. Read its § in `STATIC-UI-TO-BUILD.md`: it says exactly what the UI shows today and why.
2. Build the backend. Add a migration as `V14x__…sql`, idempotent. **Grant any new permission to OWNER** too, or the app won't start (`OwnerPermissionInvariantCheck`). Add unit tests.
3. Switch the UI on. The pages use `src/design/module/ModuleKit.tsx`: keep using its parts.
4. Write a live test in `apps/platform/e2e/recovery/` against the local recovery server. Make it remove everything it creates.
5. Update `STATIC-UI-TO-BUILD.md` (mark it done) and this file (delete the line).
