# Demo data added for the screenshot pack (2026-09-24)

Local recovery runtime only. Seeded through the real API
(`apps/platform/e2e/recovery/seed-design-demo-data.mjs`, idempotent — safe to
re-run) so permissions, validation and side effects applied exactly as they
would from the UI. Nothing was written directly to the database.

Added: today's attendance check-in (owner + reader), a time entry each, a
pending WFH request each, a pending shift-change request (reader), a
completed overtime record awaiting review, a notification template, an
integration connection, an expense policy, a PLI target and award, a
certified skill (reader), a performance goal each, a letter distribution job,
and salary structures (owner ₹18,00,000 / reader ₹9,00,000 CTC).

Screenshots were re-captured for every affected page — empty states dropped
from 54 to 7 (out of 98 recaptured / 235 total).

## The 7 remaining empty states — each a real finding, not a seeding gap

| Screen | Why it's still empty | This is |
|---|---|---|
| `/hrms/employees` → Add Employee (dialog) | Shows a live directory search inside the create form; blank until you type | expected |
| `/hrms/attendance` → Face Punch Logs | No face-recognition device data exists locally (hardware feature) | expected — flagged in `04-attendance-and-time.md` as PARTIAL |
| `/hrms/learning` → Skill Matrix / Certifications | These tabs default to the first employee in the picker ("Local Onboarding QA"), not the one with seeded data — a real click ("search → Reader User") is needed, which the capture script doesn't make on your behalf | capture-script limitation, not a product bug |
| `/hrms/pli` → My Incentives | The seeded PLI award belongs to Reader; the *owner's own* incentive tab has none — correct behaviour | expected (seed reader's award again under the owner's id if you want this tab non-empty too) |
| `/me/payslips` (owner) | Needs a **locked/paid** payroll run, not just a salary structure. Locking a run is a real payroll-engine action with financial side effects (protected area per project rules) — deliberately not automated here | needs a decision: run + lock a demo payroll cycle, or leave as the empty state design |

Re-run seeding: `node e2e/recovery/seed-design-demo-data.mjs` (from `apps/platform`).
Re-run capture for specific routes: `CAPTURE_ONLY=/route1,/route2 node e2e/recovery/capture-design-screens.mjs`.
