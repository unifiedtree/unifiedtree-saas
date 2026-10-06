# Per-company billing — plan for next week (after Fri 9 Oct)

Owner decision (6 Oct): this week the business keeps ONE subscription and ONE autopay, with a per-company breakdown
(Settings → Billing → Billing by company). Next week: each company gets its own subscription, autopay and invoice,
and nclever is moved over. Estimate: **4–5 working days**, plus the client re-approving autopay for each company.

## Where we start (as of 6 Oct)
- `platform.subscriptions` is keyed by business (`tenant_id`), one row per module subscription; the HRMS package is one
  Razorpay subscription (quantity = seats). No `company_id` anywhere in billing.
- Seats are counted per business; soft limit, reminders (V144_1), grace and module pause are per subscription.
- We issue no invoices ourselves: Razorpay emails one per charge, with the business's details.
- `org.companies` has `name`, `legal_name`, `gstin`, `pan_number`; the address is on the head-office branch.

## Target
- Each HRMS company has its own subscription (own seat count, monthly or yearly), its own autopay (card / UPI / bank)
  and its own invoice with that company's legal name, address and GSTIN.
- The owner (or someone with billing permission) manages all companies' plans from Business settings → Billing.
- If one company doesn't pay, only that company's HRMS pauses after the grace; the business's other companies keep working.

## Work (≈ 4–5 days)
| Day | What |
|---|---|
| 1 | **Data.** `company_id` on `platform.subscriptions`, `plan_change_requests` and `billing_reminders_sent` (nullable = today's business-wide rows) — migration V144_x, JdbcTemplate only. Seat count per company (`hrms.employees.company_id`). Backfill: none (existing rows stay business-wide until moved). |
| 2 | **Razorpay.** One Razorpay *customer* per company (legal name, email, GSTIN → shows on Razorpay's invoice); subscription per company with `company_id` in its notes; checkout / plan-change / seat-change take a company; webhooks already match by `razorpay_subscription_id`. Invoices: list a company's past invoices from Razorpay's invoice API (by subscription) on the billing page. |
| 3 | **Rules per company.** Soft limit and `/v1/workspace/seats/usage` per current company (`X-Company-Id`, already carried); reminders name the company; module pause looks at the *current company's* subscription and fills `companyId` in the 402 body (contract §2 already has the field); trial: see Q1. |
| 4 | **Screens.** Billing page: one card per company (plan, seats, next charge, autopay status, invoices) + "Set up autopay" per company; Plan page takes a company; the "Billing by company" table becomes the list of company subscriptions. Saiteja's lane: the "payment needed" screen uses `companyId`. |
| 5 | **Moving nclever + tests.** Live tests (two-company fixture: Company A pays, Company B unpaid → only B pauses); the move below. |

## Moving nclever (and any other paying business)
1. Their current business-wide subscription stays live until the per-company ones are set up — no gap in service.
2. If they have **one** company: we attach the existing subscription to it (`company_id` set; Razorpay unchanged).
3. If they have **several**: the existing subscription becomes the first company's; the owner sets up autopay for each
   other company (Razorpay needs the payer to approve each new mandate — this is the "client re-approves" step).
   Seats move from the shared subscription to each company's own count; we change the first one's quantity to match.
4. We tell the client the date beforehand; nothing is charged twice (new company subscriptions start on the old cycle's date).

## Questions for the owner (before Day 1)
1. **Trial:** 7 days once per business (first company), or 7 days for every new company?
2. **A new company** created inside HRMS: free until its owner buys seats, or blocked from adding people until then?
3. **Billing cycle** may differ per company (one monthly, one yearly)? (Simplest: yes, each picks.)
4. **Who pays** for a company: always the business owner / billing admins, or can a company have its own payer contact
   (its own email for invoices and reminders)?
5. **nclever's move date** and who on their side approves the new autopay(s).
