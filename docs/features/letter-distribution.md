# Letter Distribution (Bulk)

Send one letter template to **many employees at once** — each recipient gets a
**personalized** PDF (their own merge-field values) emailed to them. Built on top
of the existing single-letter Generate flow; nothing about one-at-a-time changes.

- **Permission:** `hrms.letters.distribute` (SUPER_ADMIN + HR_MANAGER only).
- **Nav:** HRMS Core → Letters → **Distributions**.
- **Route:** `/hrms/letters/distributions`.

## When to use it
- Monthly payslip / salary-certificate sends to all staff.
- Policy broadcasts (e.g. PoSH policy) to a department or the whole company.
- Any case where the same letter goes to a group — instead of generating one by one.

For a single employee, keep using **Letters → Generated → Generate** (unchanged).

## How to use it (the wizard)
1. **Distributions → New Distribution.**
2. **Step 1 — Template:** pick an active letter template (subject preview shown).
3. **Step 2 — Recipients:** choose who:
   - **All employees**, **By department**, **By designation**, **By employment type**, or **Custom list** (searchable employee picker).
   - A live count shows *"This will send to N employees"* and warns if any have **no email** (those are skipped).
4. **Step 3 — Message:** a **Title** (job name), optional **email subject** (defaults to a standard one), and a **message** shown in the email body above the attachment.
5. **Step 4 — Confirm:** review + a warning that *"This will send N emails immediately — cannot be undone."* → **Send**.

You land on the **detail page**, which polls every 3s and shows live status, a sent/failed/pending summary, and a per-recipient table. Polling stops once the job is terminal.

## Recipient filters
| Filter | Targets |
|---|---|
| All employees | every active employee in the tenant |
| By company / department / designation | active employees matching the selected IDs |
| By employment type | FULL_TIME / PART_TIME / CONTRACT / INTERN / CONSULTANT |
| Custom list | exactly the employees you tick |

**Recipients are snapshotted at creation** — adding employees to a department later does **not** change a past distribution.

## Statuses
- **Job:** `PENDING → PROCESSING → COMPLETED` (all sent) · `PARTIAL_FAILURE` (some failed) · `FAILED` (all failed).
- **Recipient:** `PENDING → GENERATING → SENT` · `FAILED` (with an error message) · `SKIPPED` (no email on file).

## Retry
If any recipients fail (e.g. mail server down), the detail page shows **Retry Failed** — it re-queues just the `FAILED` recipients. Successful ones are not re-sent.

## Behavior notes
- **Personalized:** each recipient gets their own rendered PDF (own merge-field values), not one shared file.
- **Async + non-blocking:** creating a distribution returns immediately; sending happens on a background worker (`letterDistributionExecutor`), so a slow/unreachable mail server never blocks the create call.
- **No-email recipients** are recorded as `SKIPPED`, not failed.
- **Batch cap:** 500 recipients per job (split larger sends into multiple jobs).
- **Audited:** each create and each send writes an `audit.events` row (`DISTRIBUTION_CREATED` / `DISTRIBUTION_SENT` / `DISTRIBUTION_SEND_FAILED`).

## API
| Method | Path | Permission |
|---|---|---|
| POST | `/v1/letters/distributions` | `hrms.letters.distribute` → `202` + job |
| GET | `/v1/letters/distributions` | `distribute` or `hrms.letters.read` |
| GET | `/v1/letters/distributions/{jobId}` | `distribute` or `read` (includes recipients) |
| POST | `/v1/letters/distributions/{jobId}/retry` | `hrms.letters.distribute` |

`POST` body: `{ templateId, title, customMessage?, subjectOverride?, recipientFilter: { type, values?, employeeIds? } }`.

## Deploy note
This feature adds DB migrations — **`V058__letter_distribution.sql`** (tables + RLS) and **`V059__letter_distribution_permission.sql`** (the permission grant). On Railway (Flyway disabled) these must be applied by hand at deploy. See `HRMS_DEPLOY_RUNBOOK.md`.
