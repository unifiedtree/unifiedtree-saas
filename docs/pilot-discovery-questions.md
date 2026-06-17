# Pilot Discovery Questions

## How to use this doc

Each question below came up during the build. The **default behavior shipped**
is documented per question (verified against the actual code/migrations as of
the 14-prompt build, June 2026). The "if they say X" branches describe what
becomes future work based on the customer's answer.

Ask these conversationally during pilot demos and discovery calls. Don't read
them off the doc — internalize them, then bring them up naturally when the
relevant feature comes up in the demo.

Mark a question as resolved by moving it to **Resolved Questions** at the bottom
with the date + customer name + their answer + decision made.

> **How this doc is laid out:**
> 0. **Pilot Qualifiers (next section)** — two fit/no-fit checks to run BEFORE you
>    even schedule a demo. If either is wrong, you're having a different
>    conversation, not a product walkthrough.
> 1. The core 10 (MUST / SHOULD / NICE) — the questions this doc was scoped around.
> 2. **Additional questions surfaced during creation** — real design choices found
>    while verifying the build that the core 10 don't cover. Scan that section's
>    index first; several are MUST-ASK (salary confidentiality, payroll
>    calculation assumptions, leave approval levels).

---

# Pilot Qualifiers — ask BEFORE scheduling a demo

These are not discovery questions — they're **fit / no-fit checks**. Run them in
the first call (or over email) *before* you invest 45 minutes in a demo. If a
qualifier comes back wrong, the conversation changes from *"let me show you the
product"* to *"let me understand whether we're a fit, and what would have to
change for us to be."*

### Pre-demo checklist

Before scheduling a pilot demo, verify:

- [ ] **Payroll is India-only** — the payroll engine is built entirely around
      Indian statutory rules (PF, ESI, state Professional Tax, LWF, old/new tax
      regime). Any non-India payroll is out of scope today. *(Qualifier 1)*
- [ ] **All target users have individual email accounts** — accounts are created
      by emailed invitation link; there is no email-less login path. A field/shift
      workforce without email can't be fully rolled out yet. *(Qualifier 2)*
- [ ] **Headcount is roughly 5–200** — the SMB sweet spot. Below ~5 the product is
      heavier than they need; above ~200 you hit the role-scoping / configurable-
      RBAC conversations (Q1, A1) sooner.
- [ ] **They accept a pilot with rough edges** — several capabilities are
      configurable-but-inert or not-yet-built (see the MUST additions). A pilot
      customer needs to be comfortable with that.

If all four hold → proceed to the demo and use the discovery questions below.
If any fail → have the fit conversation first; don't demo software they can't use.

---

### Qualifier 1: Is your payroll India-only?  *(disqualifier if not)*

**Question:**
> "Our payroll is built around Indian statutory rules — Provident Fund, ESI, state
> Professional Tax, Labour Welfare Fund, and the old-vs-new income-tax regime. Are
> you running Indian payroll? If so, in which states?"

**Why it matters:**
Every statutory head defaults to **OFF** (a new tenant runs gross-only until
configured), and PT slabs are seeded for **8 states only** (KA, MH, TN, TS, AP,
WB, GJ, KL). A non-India customer isn't a config away — the payroll module
doesn't model their rules at all. This is a fit decision, not a setting.

**What you'd do:**
- *India + standard heads* → Qualified. Enable PF/ESI/PT (+LWF if applicable), set
  the PT state(s), pick the default tax regime and the cycle/processing day during
  onboarding. (Deeper calculation config in A3.)
- *India, state with no PT* → Qualified; PT simply stays off for them (correct).
- *Outside India* → **Not a payroll fit.** Either scope a localization effort
  before committing, or pilot only the non-payroll modules (HR / attendance /
  leave).

### Qualifier 2: Do all target users have email?  *(rollout blocker if not)*

**Question:**
> "Everyone gets their login from an emailed invitation link they click to set a
> password. Do all the people you'd put on the system have individual work email
> addresses — including any shift or field staff who'd punch attendance?"

**Why it matters:**
Account provisioning is **invitation-email-only** — no admin-set-password, no
email-less / kiosk / phone login. A workforce segment without email (common for
field/shift staff who still need attendance) can't be onboarded today, so the
rollout stalls for that segment.

**What you'd do:**
- *Everyone has email* → Qualified. Proceed with bulk invites; confirm the sending
  domain and invite-link base are set in prod.
- *Some have no email* → **Partial-fit.** Scope an alternative (admin-set password,
  shared-device/kiosk punch, phone login) — none built today — or limit the pilot
  to the email-having population.
- *They want bulk activation without per-person clicks* → Scope an admin
  bulk-activate flow before go-live.

---

# Priority: MUST ASK

These are questions where shipping the current default to the wrong customer
would create friction or a compliance problem.

### Q1: Finance role scope

**Question (conversational):**
> "In your org, who typically approves leave requests? Who creates HR letter
> templates like offer letters? Who imports new employees in bulk? Is that all
> the same person, or different roles?"

**Why it matters:**
The `FINANCE_LEAD` role is described as payroll/reports, but **as shipped it also
holds**: two-level leave approval (`leave.approve.l1` **and** `l2`), full letter
management (`letters.template.create/update/delete` + generate/send/void), and
bulk `employee.import` — on top of reports and directory read. For a company
under ~30 where one person wears every hat, that's convenient. For a larger
company it's a separation-of-duties concern: the same person approving leave,
issuing offer letters, importing staff, **and** locking payroll is real fraud
surface. (Worth knowing: the finance leave-approval grant came in via a seed
block whose SQL comments mislabel the role as a non-existent "COMPANY_ADMIN", so
this is partly an unintended over-grant — see the V052 action below.)

**Likely answers + what you'd do:**
- *"Finance does all of those at our scale"* → No change. Current config is right
  for them. Document it and get explicit pilot sign-off given the SoD note.
- *"HR does leave, letters and onboarding; finance only does payroll"* → Plan a
  post-pilot RBAC-tightening migration (**`V052__tighten_finance_lead_permissions.sql`**
  — note V050/V051 are already used): revoke `leave.approve.l1`+`l2`,
  `letters.template.*` (+ generate/send/void), `employee.import`, and
  `attendance.regularization.approve` from the FINANCE_LEAD seed; keep reports +
  read-only directory.
- *"It's mixed — finance does some, HR does some"* → Plan post-pilot configurable
  RBAC per tenant: give the customer a control surface to enable/disable
  per-permission rather than hardcoding one role shape.

### Q2: Department manager directory scope

**Question:**
> "If a department manager looks at the employee directory in our system, should
> they see everyone in the company? Or only people on their team?"

**Why it matters:**
Today `DEPT_MANAGER` can list and open **every employee in the tenant** — the
directory and the single-employee endpoint apply only the filters the manager
chooses (company/department/search); nothing scopes by the manager's own team or
reporting line. The genuinely-sensitive PII — identity documents (PAN/Aadhaar/
passport) and bank accounts — **is** correctly gated (only HR and Admin can read
those). **But heads up:** the directory record itself also carries **salary
(annual CTC), date of birth and phone**, with no field-level masking, so a
manager (and finance) currently sees teammates' pay. That salary exposure is its
own MUST-ASK (see **A1** below); this question is specifically about *which
people* a manager can see at all.

**Likely answers + what you'd do:**
- *"Yes, the company directory is open to all managers"* → No change to the
  who-can-be-seen scope (still resolve the salary-field question in A1).
- *"Managers should only see their own team"* → Plan post-pilot team-scoping of
  the `/v1/hrms/employees` list + the single-employee fetch for DEPT_MANAGER.
  This is a real build (caller-derived department/reporting-line query
  predicates + an ownership check on the detail endpoint), not a seed tweak.
- *"It depends on the manager's seniority"* → Discussion needed: tiered manager
  roles, or a per-manager scope flag?

### Q3: Attendance check-in design

**Question:**
> "How do your employees mark attendance today? Mobile face-scan? Web check-in
> from the office? Manual entry by HR? Biometric devices?"

**Why it matters:**
The attendance module is owned by a teammate, so confirm the customer's real
workflow against what's wired.

**Current shipped status (verified — replaces the earlier "422" assumption):**
A normal web check-in **works and returns 200** — the platform's "Check In"
button posts a plain web/manual punch (with optional browser location) and is
accepted. The 422 some notes referred to only happens on specific business
rules: a *second* check-in the same day (already-checked-in), a punch *outside*
the geofence *when hard enforcement is on*, or a *failed face match*. None of
those apply to a normal first punch.
Two important nuances:
- **Geofence is advisory, not enforced** in the pilot profile — location is
  captured but an out-of-zone punch still succeeds (hard-block is off).
- **Face recognition is fully built** (enrollment, encrypted templates, liveness,
  lockout) and is even **switched on by default in production config**, but the
  actual web punch widget does **not** capture a face — it's a one-tap button. So
  the biometric path exists but isn't wired into the everyday punch yet.

**Likely answers + what you'd do:**
- *"We use [biometric / mobile app / web check-in]"* → Note their setup and match
  it to the above. If they want face or geofence *enforced*, that's the
  attendance-enforcement decision in **A10**.
- *"We're flexible — whatever works"* → Lower priority; tap-based web punch is the
  safe default for the pilot.
- *"We can't pilot without [specific mechanism]"* → Becomes a blocker; coordinate
  with the module owner immediately (especially if it's enforced face/geofence,
  which need wiring).

---

# Priority: SHOULD ASK

These are questions where the current default is reasonable but a
customer-validated answer would improve the product.

### Q4: Dark mode

**Question:**
> "Do your employees typically use light or dark themes for work applications?
> Does it matter for this pilot?"

**Why it matters:**
Dark theme is disabled for v1 (a force-light flag) because the migration to
design tokens isn't complete — on the order of ~1,200+ hardcoded color values
across dozens of files in the platform app (the "~1,711 / 98 files" figure
includes Tailwind color utility classes too; magnitude is right, exact number is
approximate). A customer-driven priority signal decides whether to invest in the
migration post-pilot.

**Likely answers + what you'd do:**
- *"Doesn't matter / we use light"* → Defer the dark-theme migration indefinitely.
- *"Some of our team strongly prefers dark"* → Schedule the migration as
  post-pilot polish.
- *"We can't use a product without dark mode"* → Re-prioritize; do the token
  migration before broad rollout.

### Q5: Letter template customization

**Question:**
> "Do you need to customize letter templates (offer letters, experience letters,
> etc.) to match your company's tone and branding? Or are standard templates
> fine?"

**Why it matters:**
The system supports fully custom templates with merge fields (`{{employee.fullName}}`,
`{{employee.ctc}}` with Indian lakh/crore + amount-in-words, `{{company.pan}}`,
date tokens, etc. — 27 fields, inserted from an editor dropdown). **Correction to
the earlier assumption:** there are **no seeded/default templates at all** — a
new tenant starts with a blank screen and must author every letter — and there
are **no India-specific clauses (PoSH, gratuity) pre-written**. There's also **no
content version history** (editing a template overwrites in place; already-issued
letters are snapshotted and safe, but template edits aren't tracked). This makes
the customer's answer more consequential than "standard vs custom" implies — see
**A7** for the starter-pack / numbering / e-sign follow-ups.

**Follow-up — bulk vs one-at-a-time (both now shippable):**
> "Do you need to send the same letter to many employees at once (e.g. monthly
> payslips, a policy broadcast) — or always one person at a time?"

Both answers now map to features that exist:
- *"One at a time"* → the existing **Letters → Generate** flow (pick employee, generate, send/download).
- *"Many at once"* → the new **Letter Distribution** feature (`hrms.letters.distribute`, HR-only): pick a template, filter recipients (all / department / designation / employment-type / custom list), each gets a personalized PDF emailed; failures are retryable. See `docs/features/letter-distribution.md`. (Adds migrations `V058`/`V059` — relevant to the deploy, not the customer.)

**Likely answers + what you'd do:**
- *"Standard templates are fine"* → They still need *some* templates authored;
  offer to seed a starter pack (see A7). Mention numbering/e-sign as options.
- *"We need our letterhead and specific clauses"* → Walk through the template
  editor in the demo; plan a setup session and capture their exact wording so
  merge fields map cleanly.
- *"We have very specific compliance language requirements"* → Discuss merge
  fields, required clauses (PoSH/gratuity/notice), and the lack of template
  versioning (relevant if they need a change audit trail).

### Q6: Payroll lifecycle expectations

**Question:**
> "When you run payroll today, what happens after you lock it? Do you need bank
> transfer files (NEFT)? PF/ESI/PT reports? Payslip email distribution? Anything
> else?"

**Why it matters:**
The payroll engine ships the full run lifecycle — DRAFT → PROCESSING → LOCKED →
(PAID) — with locked payslip **PDFs** (HR downloads per employee; employees self-
download their own, gated to locked runs only). **What's not built (planned
"13b"):** NEFT/bank-transfer disbursement files, statutory return generation (PF
ECR, ESI return, PT challan/summary), and payslip **email** distribution
(payslips are pull-only today). The "PAID" status is just a flag — there's no
payment file behind it. The customer's actual post-lock workflow tells us which
of these to prioritize.

**Likely answers + what you'd do:**
- *Lists 3+ of the planned post-lock outputs* → Validates the 13b roadmap;
  prioritize accordingly.
- *"We use [external system] for that part"* → 13b may be lower priority;
  integration/export to that system becomes the work instead.
- *"We just need payslips and we handle the rest manually"* → 13b is less urgent;
  consider a simple net-pay list export as the bridge.

### Q7: Onboarding template usage

**Question:**
> "When someone new joins your company, what's the checklist? Who owns each step?
> How long does onboarding usually take?"

**Why it matters:**
Onboarding templates exist with per-task due-offsets (joining date + N days). But
the task "owner" is just a **free-text label** (e.g. "HR", "IT") — it doesn't
route the task to a named person and doesn't restrict who can tick it off (anyone
with the onboarding permission can complete any task). There are **no reminders/
overdue alerts**, **no file upload** on tasks (a "collect PAN card" task can't
hold the actual file), and instances are started **manually** (no auto-trigger on
hire). So the customer's real process tells us whether the current lightweight
model fits — see **A15** for the assignment/reminder/upload follow-ups.

**Likely answers + what you'd do:**
- *"Sounds like what you've built"* → Demo the template feature; help them create
  theirs.
- *"We have a much more detailed process"* → Note their checklist; the gaps
  (named assignees, reminders, document upload) become post-pilot scope.
- *"We don't formally onboard"* → Lower-priority module for this customer.

---

# Priority: NICE TO ASK

Background questions that inform product direction but don't block the pilot.

### Q8: Company size and growth

**Question:**
> "How many employees today? What do you expect in 12 months?"

**Why it matters:**
Determines whether the SMB defaults fit, whether they'll hit
permission-tightening needs as they grow (Q1), and whether configurable RBAC is
urgent for them.

### Q9: Multi-company tenancy

**Question:**
> "Is this for one company, or multiple sister companies under the same group?"

**Why it matters:**
The system supports multiple companies within one tenant — branches,
departments, the directory, and **payroll runs** are all company-scoped (each
legal entity runs payroll separately; there's no consolidated cross-entity run).
If they have multiple entities, the company-picker UX matters — and note today's
picker lives **only inside Organisation Setup** ("Viewing for:" dropdown); there
is **no global company switcher** in the app header, so cross-module context
isn't one global toggle (see **A16-adjacent** note in A-section). If single
company, de-emphasize all of this.

### Q10: Integration needs

**Question:**
> "Do you currently use any other HR or payroll software? What works well? What
> doesn't? Anything you'd want to integrate this with?"

**Why it matters:**
There are **no external integrations shipped today** — no SSO/SAML, no Slack, no
accounting (Tally/Zoho/QuickBooks), no biometric-device sync. The only outbound
integration is transactional email. So this is greenfield: their answer tells us
competitive positioning and the integration roadmap (and SSO specifically is its
own question — see **A11**).

---

# Additional questions surfaced during creation

*(All questions in this section were **added during creation** — they're real
design choices found while verifying the build against the code, not part of the
original 10. Scan the index, then jump to the ones the demo touches.)*

**MUST-ASK additions**
- **A1** — Who can see **salary** in the directory? (managers + finance currently can)
- **A2** — **Payroll statutory scope** → *promoted to **Qualifier 1** (top)*
- **A3** — **Payroll calculation assumptions**: pay cutoff + "no punch = paid"
- **A4** — How employees **get logins** → *promoted to **Qualifier 2** (top)*
- **A5** — **Leave approval levels** (one approval vs manager→HR; who approves)

**SHOULD-ASK additions**
- **A6** — Leave **year / accrual / carry-forward / encashment**
- **A7** — Letters: **starter pack**, reference numbering, approval/e-sign
- **A8** — **Report exports** + statutory registers (on-screen only today)
- **A9** — **Holiday calendars** per location + workweek/weekend days
- **A10** — Attendance **enforcement**: face on/off, geofence advisory vs block
- **A10b** — Punch verification model: GPS+Face **both** vs **either** (web↔mobile mismatch; coordinate w/ attendance owner)
- **A11** — **SSO / identity provider** requirement

**NICE-TO-ASK additions**
- **A12** — **Probation** policy (duration, reminders, auto-extend)
- **A13** — **Payslip branding** + statutory IDs on the PDF
- **A14** — **Data residency / biometric consent / retention**
- **A15** — Onboarding mechanics (named assignees, reminders, document upload)
- **A16** — Should regular **employees** get a (redacted) company directory back?

---

## MUST-ASK additions

### A1: Salary confidentiality in the directory *(added during creation)*

**Question:**
> "Right now anyone who can open the employee directory — your department managers
> and your finance lead, not just HR — sees each person's annual CTC, date of
> birth and phone alongside their name. Is that acceptable, or should pay be
> visible only to HR/Admin (and Finance) and hidden from line managers?"

**Why it matters:**
The directory record returns `ctcAnnual`, `dateOfBirth` and `phone` to **every**
directory reader, with no field-level masking. Identity/bank are gated, but
salary is not. It's low-impact in the demo only because CTC columns are empty —
the moment real salaries are loaded, every manager sees teammates' pay. This is
the residual after the V051 fix (which removed base employees from the directory
entirely).

**Likely answers + what you'd do:**
- *"Managers must NOT see salary"* → Add a redacted directory projection that
  strips `ctcAnnual` (likely DOB too) unless the caller holds a new
  `hrms.employee.compensation.read` permission; grant it to HR/Admin/Finance only.
- *"Only HR and Finance see salary"* → Same redaction, with the comp permission
  granted to HR_MANAGER/SUPER_ADMIN/FINANCE_LEAD and withheld from DEPT_MANAGER.
- *"Everyone with directory access may see pay"* → Document as intended; get
  explicit written pilot sign-off before loading real salary data.

### A2: Payroll statutory scope → see **Qualifier 1** (top)

This is a fit/no-fit check, so it was **promoted to Pilot Qualifier 1** at the top
of the doc (India-only payroll; all heads default OFF; PT seeded for 8 states).
The enablement/config follow-ups live there and in A3.

### A3: Payroll calculation assumptions *(added during creation)*

**Question:**
> "Two quick payroll basics: (1) Is your pay period a full calendar month, or a
> custom cutoff like the 21st-to-20th? (2) If someone has no attendance record and
> no approved leave on a working day, should they be **paid** by default, or should
> missing attendance withhold pay?"

**Why it matters:**
Both are silent net-pay risks today:
- The settings store a cutoff (`payrollCycleStartDay/EndDay`) but the engine
  **ignores it** — every run is computed over the full calendar month. A
  21st-to-20th customer would get wrong LOP/proration.
- The engine is **exception-based**: an unmarked working day is paid as PRESENT;
  only an explicit absence/unpaid-leave creates loss-of-pay. If the customer
  expects "no punch = unpaid", payroll will silently overpay.

**Likely answers + what you'd do:**
- *Full calendar month + pay-unless-absent* → Matches the shipped behavior;
  confirm and document.
- *Custom cutoff* → Real gap — either lock the pilot to calendar-month or scope
  window-aware period + LOP before go-live.
- *"No record should mean unpaid"* → Needs a per-tenant toggle flipping the
  default day status; flag as a change.

### A3b: Professional Tax — which state(s)? *(added post payroll-audit, 2026-06-16)*

**Question:**
> "For Professional Tax, which state(s) are your employees taxed in?"

**Why it matters:**
The payroll engine applies PT as a **flat monthly amount every month** (the per-state
slab; PayrollEngine.java:164-166). That is **correct for Telangana, Andhra Pradesh,
Karnataka (monthly), Tamil Nadu** as seeded — but **wrong for Maharashtra** (MH levies
₹300 in February, ₹200 other months; the engine charges a flat ₹200 → under-collects
₹100/employee/year, a statutory liability) and for any state billing PT **half-yearly**
(the payslip deduction line won't match what the accountant files). PT slabs are seeded
for 8 states only (KA, MH, TN, TS, AP, WB, GJ, KL); other states get no PT. See
`docs/PAYROLL_AUDIT.md` P1-2.

**Likely answers + what you'd do:**
- *Telangana / Andhra / Karnataka(monthly) / Tamil Nadu* → flat-monthly is correct; no change.
- *Maharashtra* → **P1-2 becomes pre-pilot**: make PT month-aware (Feb ₹300).
- *Half-yearly-billing state, or a state not in the 8 seeded* → seed its slabs and/or add
  period-aware PT before go-live.

### A4: How employees get into the system → see **Qualifier 2** (top)

This is a rollout blocker if it's wrong, so it was **promoted to Pilot Qualifier 2**
at the top of the doc (accounts are emailed-invitation-only; no email-less login
path for field/shift staff).

### A5: Leave approval levels *(added during creation)*

**Question:**
> "When someone applies for leave, should it need just their manager's approval, or
> manager-then-HR (two steps)? And should each approver see only their own team's
> requests, or the whole company's pending list?"

**Why it matters:**
The system models a **two-level** chain (L1 = manager, L2 = HR, plus an escalated
state). Today HR and **Finance** both hold L1+L2 (the finance grant is likely
unintended — see Q1); DEPT_MANAGER holds L1 only. Whether the org wants 1-step or
2-step approval, and who sits at each level, is a seed/config decision. Also: the
L1 approver queue's team-scoping is **unverified** against seed data (it may
currently surface whole-tenant pending requests).

**Likely answers + what you'd do:**
- *"Single approval"* → Seed only L1 to managers; skip L2; simplify the approval UI.
- *"Manager then HR"* → Keep L1=DEPT_MANAGER, L2=HR_MANAGER, and **remove leave
  approval from FINANCE_LEAD** in the V052 tightening migration.
- *"Approvers should see only their team"* → Verify/implement L1-queue team-scoping
  before go-live (currently unverified).

---

## SHOULD-ASK additions

### A6: Leave year, accrual, carry-forward, encashment *(added during creation)*

**Question:**
> "How should leave work for you — does the leave year start in April or January?
> Are balances granted as a lump sum at year start, or accrued monthly/quarterly?
> What carries forward (and the cap)? Do you do leave encashment?"

**Why it matters:**
Leave types support YEARLY/MONTHLY/QUARTERLY accrual and carry-forward caps;
fiscal year defaults to **April** (per company). India defaults are seeded (PL 18
/ SL 12 / CL 12) but all editable. There is **no leave-encashment** field or flow.

**Likely answers + what you'd do:**
- *Annual grant on a fiscal year* → Set the fiscal-year start + YEARLY accrual +
  carry-forward caps per type.
- *Monthly/quarterly accrual* → Set the accrual frequency and confirm proration
  for mid-year joiners.
- *Encashment needed* → Flag as a gap (not built); scope it, else confirm
  out-of-scope.

### A7: Letters — starter pack, numbering, approval/e-sign *(added during creation)*

**Question:**
> "Three things on letters: (1) Do you want us to pre-load a starter pack of
> India-ready templates (offer/appointment/relieving/experience) — you'd start
> from a blank editor otherwise? (2) Do your letters need a formal reference
> number printed on them? (3) Before a letter goes out, does it need internal
> approval or the employee to e-sign/acknowledge?"

**Why it matters:**
There are **no seeded templates** (blank on day one). Letters are identified only
by an internal UUID — **no human-readable reference number**. And while the
schema has a "SIGNED" status, there's **no sign/approval endpoint** — the flow is
generate → email PDF → void. All three are common Indian-HR expectations and are
build, not config.

**Likely answers + what you'd do:**
- *Starter pack wanted* → Build a seed migration of standard templates using the
  merge-field catalogue; confirm the clause list (PoSH, gratuity, notice, PF/ESI).
- *Reference numbering wanted* → Add a per-tenant/per-type sequence + format, expose
  as a merge field.
- *Approval/e-sign wanted* → Scope a draft→approved gate and/or an
  acknowledge/e-sign step (external e-sign integration if a real signature is
  required).

### A8: Report exports and statutory registers *(added during creation)*

**Question:**
> "We have six built-in reports — headcount, attrition, attendance summary, leave
> balance, late marks, diversity — shown on screen. Do you need to download these
> as Excel/CSV/PDF? And do you need statutory registers (PF/ESI/PT muster, salary
> register, Form 16)?"

**Why it matters:**
All six reports are **on-screen JSON only** — there's no export endpoint and no
statutory register generation. HR/finance pilots usually need downloadable
reports and compliance registers; both are build, not config.

**Likely answers + what you'd do:**
- *On-screen is enough for the pilot* → Confirm; note export as a fast-follow.
- *Excel/CSV export needed* → Add export to the six reports.
- *Statutory registers needed* → Scope separately (currently absent).

### A9: Holiday calendars and the workweek *(added during creation)*

**Question:**
> "Do all your offices observe the same public-holiday list, or do different
> branches/states need their own? And what's your standard workweek — Sat+Sun
> weekend, or a 6-day week / different weekend?"

**Why it matters:**
Holidays support **per-branch** scoping and types (national/regional/optional/
restricted), so multi-location lists are possible. But the workweek/weekend
defaults to **Sat+Sun** and a single late-threshold/standard-day per company — a
6-day week or non-standard weekend gives wrong attendance/LOP math until
reconfigured.

**Likely answers + what you'd do:**
- *One shared list, Sat+Sun* → Shipped defaults are fine.
- *Per-state/site holidays* → Configure branch-scoped holiday sets (supported).
- *6-day or non-standard weekend* → Set weekend days per company at onboarding.

### A10: Attendance enforcement — face & geofence *(added during creation)*

**Question:**
> "For attendance, do you want face verification required at punch-in, a simple
> tap, or both depending on the group? And should we restrict *where* people can
> clock in (only inside an office radius), or is recording their location enough?"

**Why it matters:**
Face recognition is fully built and **on by default in production**, yet the
everyday web punch is a plain tap with no face capture — so enabling face means
wiring capture into the punch flow, running the face worker, and an enrollment +
**consent** campaign. Geofencing is **advisory only** today (location captured,
out-of-zone punch still succeeds); hard-block is built but switched off and not
wired to the per-branch toggle.

**Likely answers + what you'd do:**
- *Tap-only for the pilot* → Keep face disabled, drop the face worker from the
  deploy, keep geofence advisory.
- *Face required* → Wire face into the punch, stand up the face worker, run
  enrollment + capture biometric consent.
- *On-site enforcement required* → Turn on geofence zones, set each site's
  lat/long + radius, decide block-vs-flag; per-branch if only some sites are
  restricted.

**A10 follow-up (logged 2026-06-17):** the `Branch` entity already supports `latitude`/`longitude`/`geo_fence_radius_meters`/`geo_fence_enforced`, and check-in validates against the employee's **branch** fence (`GeoValidationService` haversine) — but the **web Branch creation form doesn't expose those fields**, so web-created branches have no geofence coords. If vnp wants **enforced** geofencing, it's a ~1-hour UI fix (expose lat/lon/radius on the branch form; backend + check-in already support it). Also: the codebase has **two** geofence models — branch-level (wired to check-in) and the `GeoFenceZone` entity + `employees.geo_fence_zone_id` (wired to the mobile/web zones page) — which need reconciliation with the attendance-module owner before any enforcement work. Geofence is advisory in the pilot profile, so this is post-pilot / discovery-gated, not blocking.

### A10b: Punch verification model — GPS + Face both, or either? *(added 2026-06-17)*

**Question:**
> "For employee attendance, do you require GPS location **and** face recognition (both must succeed to punch), or is one enough?"

**Why it matters:**
The manager **mobile** app models punch verification as **both GPS *and* Face required** ("employees must be inside the zone and pass a face check to punch"). The **web** platform models it as a single `punch_method` choice per geofence zone (`FACE` / `GPS` / `MANUAL`). These two clients **don't match**. Confirm the customer's expectation before pilot and align — but note this touches **punch-verification behavior** in the attendance subsystem, so any change is **coordinated with the attendance-module owner** (see `boundary.md`), not patched from the web UI.

**Likely answers + what you'd do:**
- *"Both required"* → coordinate with the attendance-module owner to make the web zone model enforce GPS+Face like mobile; confirm whether enforcement is client-side (mobile) or backend.
- *"Either one is fine"* → the web single-choice model is acceptable; verify mobile can also be configured to one factor, else the clients still diverge.
- *"Depends on the zone/group"* → per-zone verification config; size as build, coordinate with the owner.

### A11: SSO / identity provider *(added during creation)*

**Question:**
> "Will your employees log in with the email+password we manage, or do you require
> SSO via Google Workspace, Microsoft/Entra, Okta or SAML for the pilot?"

**Why it matters:**
There's **no SSO/SAML** today — auth is the app's own email/password JWT flow. If
SSO is a hard requirement it's net-new build (which IdP, JIT provisioning, role
mapping), not a toggle, and must be sized before any date commitment.

**Likely answers + what you'd do:**
- *Email/password is fine for the pilot* → Proceed; flag SSO as post-pilot roadmap.
- *SSO required* → Scope an OIDC/SAML integration before committing.
- *"Nice to have"* → Defer; note in roadmap.

---

## NICE-TO-ASK additions

### A12: Probation policy *(added during creation)*

**Question:**
> "What's your standard probation period, how far ahead should managers/HR be
> reminded before it ends, and what happens at the end — manual confirmation, or
> auto-extend if no one acts?"

**Why it matters:**
A probation lifecycle ships (reminders default 7 days before; auto-extend
defaults **off**, 90 days when on; daily reminder scan). Defaults may not match
the customer, and auto-extend on/off materially changes the employee experience.

**Likely answers + what you'd do:**
- *Fixed duration + manual confirmation* → Set the reminder lead time, keep
  auto-extend off, define who confirms.
- *Auto-extend on no action* → Enable it; set the extension length.
- *Varies by role/grade* → Flag (single tenant-wide config today).

### A13: Payslip branding & statutory fields *(added during creation)*

**Question:**
> "Does your payslip need your company logo, legal name/address and statutory IDs
> (PF UAN, ESI number, full PAN), or is a clean standard template fine for the
> pilot?"

**Why it matters:**
The payslip PDF is a single hardcoded template with the product's brand color, no
company logo/name/address, and masked PAN/bank. Indian payslips often must show
employer name and PF/ESI/UAN identifiers — that's template work (and may require
capturing those fields first).

**Likely answers + what you'd do:**
- *Clean template is fine* → Document as a known limitation.
- *Logo + legal name/address* → Add a company header (the data exists in org
  setup).
- *Full statutory IDs* → Capture UAN/PF/ESI numbers on the employee/structure
  first; flag the dependency.

### A14: Data residency, biometric consent, retention *(added during creation)*

**Question:**
> "Do you have a requirement that employee data — PII, salary, and face/biometric
> templates — be stored in a specific country/region? Any retention or deletion
> expectations we should design around?"

**Why it matters:**
The product stores sensitive PII plus optional face-enrollment templates, and the
pilot DB is on a managed cloud whose region may not match a residency
requirement. Residency/retention/biometric-consent obligations should be settled
**before** real data is loaded.

**Likely answers + what you'd do:**
- *No residency constraint* → Proceed; confirm a basic retention stance.
- *Region-specific (data must stay in India/EU)* → Confirm hosting region before
  loading real data.
- *Biometric is sensitive for them* → Confirm a consent flow, or offer to disable
  face check-in for the pilot.

### A15: Onboarding mechanics *(added during creation)*

**Question:**
> "For onboarding checklists: do you want tasks assigned to a specific person, or
> is a role label (HR / Manager / IT) enough? Should the system send reminders for
> due/overdue tasks? And do new hires need to upload documents (ID proofs, signed
> offer) against the checklist?"

**Why it matters:**
Today the task owner is a free-text label only (no routing, no completion
enforcement), there are **no reminders/overdue alerts**, and there's **no
document upload** on tasks. Each of these is net-new if the customer relies on it.

**Likely answers + what you'd do:**
- *Role label is enough, no reminders/uploads* → Standardize the label into a
  picklist; document the checklist as passive for the pilot.
- *Named assignees / enforcement* → Add an assignee + a "my tasks" view + a
  completion gate.
- *Reminders and/or document upload needed* → Scope a reminder job and task-level
  attachments.

### A16: A company directory for regular employees *(added during creation)*

**Question:**
> "Right now a regular employee has no company directory — they only see their own
> data. Many companies want a basic 'who's who' (name, department, work email) for
> all staff. Do your employees need that, and which fields?"

**Why it matters:**
The V051 fix deliberately removed all directory access from base employees to
close a PII leak. Giving employees a minimal directory back is a product decision —
and it must be a **new redacted endpoint** (name/dept/designation/work-email
only), **not** a re-grant of the old permission (which exposes salary/DOB/phone).
(Related: in multi-company tenants, company selection is per-screen today — no
global switcher — worth noting if their admins juggle several entities.)

**Likely answers + what you'd do:**
- *No directory for staff* → Keep V051 as-is; employees stay self-service only.
- *Yes, minimal directory* → Build a redacted endpoint + a lightweight permission;
  do not re-grant `hrms.employee.read`.
- *Org chart only* → Expose reporting structure without contact/PII.

---

## NAV/PERM AUDIT FINDINGS

*(For the engineer to fill in during the Day 7 walkthrough. Each role/permission/
nav mismatch found goes here for later resolution.)*

Format:
```
Role:               ROLE_NAME
Permission:         perm.code.here
Nav state:          visible / hidden
Current behavior:   works / 403
Recommended action: reveal nav | revoke perm
Resolution:         pending customer / decided
```

Known starting entries (from the build — confirm/extend during the walkthrough):

```
Role:               FINANCE_LEAD
Permission:         hrms.leave.approve.l1 / l2, hrms.letters.*, hrms.employee.import
Nav state:          Leave & Letters nav hidden for FINANCE_LEAD; perms still allow direct-URL/API
Current behavior:   works (200) via API despite hidden nav
Recommended action: revoke in V052 if customer says Finance ≠ HR (see Q1/A5)
Resolution:         pending customer

Role:               DEPT_MANAGER
Permission:         hrms.employee.read (whole-tenant directory; DTO carries ctcAnnual/DOB/phone)
Nav state:          Directory visible
Current behavior:   works (200), tenant-wide, salary visible
Recommended action: team-scope (Q2) and/or comp-field masking (A1) per customer
Resolution:         pending customer
```

---

## RESOLVED QUESTIONS

*(Empty initially. Move questions here after pilot conversations, with: date
asked · customer name (or "Customer A") · their answer (paraphrased) · decision
made (no change / planned migration / configurable) · linked migration or
roadmap item.)*

| Date | Customer | Question | Their answer | Decision | Linked item |
|------|----------|----------|--------------|----------|-------------|
| | | | | | |
