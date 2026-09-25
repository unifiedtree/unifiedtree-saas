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

**Payroll** (§5)
- TDS calculation.


**Workspace settings** (§8)
- Invoices (Razorpay).

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
