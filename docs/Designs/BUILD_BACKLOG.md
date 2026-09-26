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

No open decisions from waves 1–2 (D1-D4 were settled on 25 Sep and built in wave 1).

From wave 3 (26 Sep), for the client:
- **My workspace (`/me`) for admins:** it still shows an owner/admin their own month of attendance. Only "My Attendance" was asked to be hidden, so it was left. Hide it too?
- **Leave types in two places:** HR can edit them on Leave → Leave types and in HRMS settings → Leave rules. Keep both (employees read the Leave tab) or make the Leave tab read-only?

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

**Found in wave 3, not fixed** (§11.20; `docs/production/DEPLOY_2026-09-26_WAVE3.md` §6)
- **Reset face enrollment** on the employee record sends the employee id to an endpoint keyed by login id, so for invited employees it probably resets nothing but reports success. Add `POST /v1/attendance/face/admin/employees/{employeeId}/reset` (via `FaceService.requireLoginFor`) and point the button at it. Until then, Re-enroll face works.
- **Daily Logs** leaves out anyone whose weekly off is the chosen day, even when they punched in.

---

## P2: polish

- **Integrations**: real connections (OAuth, keys, sync). Today it's a register only, and the page says so.
- **Global search** (§11.20): a search box (`?q=`) on the leave, documents and expenses lists; an offer deep link (`?offer=`); advances, assets, onboarding, training and departments as record types.
- **Access step** (§11.20): keep the chosen access until a later invite in onboarding; end dates on added/removed permissions.
- **Muster roll:** the date box spans the whole toolbar (`.ut-input { width:100% }` comes after the Tailwind utilities).

---

## How to work an item

1. Read its § in `STATIC-UI-TO-BUILD.md`: it says exactly what the UI shows today and why.
2. Build the backend. Add a migration as `V14x__…sql`, idempotent. **Grant any new permission to OWNER** too, or the app won't start (`OwnerPermissionInvariantCheck`). Add unit tests.
3. Switch the UI on. The pages use `src/design/module/ModuleKit.tsx`: keep using its parts.
4. Write a live test in `apps/platform/e2e/recovery/` against the local recovery server. Make it remove everything it creates.
5. Update `STATIC-UI-TO-BUILD.md` (mark it done) and this file (delete the line).
