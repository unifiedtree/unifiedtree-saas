# UnifiedTree — Master Project Context & Working Specification

> **Purpose:** This is the single source of truth for Claude/Codex/other coding agents working on the UnifiedTree SaaS + HRMS project.
>
> **How to use this file:** Read this document completely before making architectural, database, UI, billing, routing, or workflow changes. Do not assume an item marked **PENDING**, **PARTIAL**, **INTERNAL**, or **LATER** is a confirmed requirement.
>
> **Important:** Some original notes contained credentials/secrets. They are intentionally NOT reproduced here. Never store passwords, access tokens, recovery codes, or private keys in this document.

---

# 1. Executive Summary

UnifiedTree is being redesigned around this target model:

```text
ONE ACCOUNT / LOGIN
        │
        ▼
ONE BUSINESS / WORKSPACE
        │
        ├── Business-level users / roles / billing / branding / overall settings
        │
        └── HRMS
              │
              ├── Company A
              │     ├── Branches
              │     ├── Employees
              │     ├── Attendance
              │     ├── Leave
              │     ├── Payroll
              │     └── HR configuration
              │
              ├── Company B
              │     └── ...
              │
              └── Company N
```

The critical product direction is:

- **One business/workspace per account.**
- **Multiple companies inside HRMS.**
- Companies do **not** get separate URLs.
- Company switching is **global** throughout HRMS.
- Billing is **company-wise**.
- HRMS is **one package** containing HR, Attendance, Leave and Payroll.
- HRMS billing is separate from other modules.
- One person can have access to multiple companies, with the permitted companies visible in both web and app.
- The Owner can delegate purchasing/admin responsibilities.
- Business-level settings remain outside individual modules; each module has its own module settings.
- White-label is explicitly deferred until the next planning stage.
- Hospital work remains on hold until HRMS and WhatsApp are delivered.

---

# 2. Current Production / Business Facts

From the original project notes:

- 15 workspaces existed in the referenced production snapshot.
- 47 companies.
- 30 active module subscriptions.
- Existing billing was previously structured around module/workspace + employee seats through Razorpay.
- HR, Attendance, Leave and Payroll exist separately in the system but are being treated as **one HRMS package** for the new product model.
- **nclever is the only real client** in the referenced data; other workspaces were described as test data.
- CRM and Manufacturing were mentioned in older notes as subscriptions, but the later client clarification says these applications have **not actually started**. Do not assume they are live products or active launch scope.

---

# 3. CONFIRMED PRODUCT DECISIONS

These are the decisions already supplied/confirmed by the user/client. Agents should treat them as requirements unless a newer explicit decision overrides them.

## 3.1 Business / Workspace / Company Model

### Account
- One account/login should have **one business/workspace**.
- The user should not create multiple workspaces from the normal product flow.
- One business is associated with an email + mobile number in the intended model.
- Multiple companies are handled inside HRMS based on purchases.

### Workspace = Business
The workspace represents the business and owns:

- Business name
- Business branding
- Users
- Roles
- Business-level permissions
- Billing
- Modules
- Overall settings

The workspace should **not** expose HRMS companies as workspace-level entities.

### Companies belong to HRMS
- HRMS can contain multiple companies.
- Companies do not need their own URL.
- Company data changes based on the globally selected/current company.
- Company switching must affect every HRMS page.
- Companies & Branches should live inside HRMS → Organization Setup.

### Sign-up terminology
The intended direction is:
- "Company name" at business/workspace signup should become **"Business name"**.
- When HRMS is selected, the initial HRMS company can use the business name initially and be edited later.

### Existing architecture direction
The existing structure was assessed as approximately 90% compatible with this model:
- `platform.accounts` → account
- `platform.tenants` → workspace/business
- `org.companies` → HRMS companies
- `org.branches` → company branches
- HRMS data hangs from companies.

The intended change is primarily to stop multiple-workspace creation and clearly scope companies to HRMS.

---

# 4. Billing & Pricing — CONFIRMED DECISIONS

## 4.1 Who pays?
**Company-wise.**

Each company pays for itself.

## 4.2 Pricing basis
Pricing is based on **number of users/employees**, not employee type.

The customer chooses how many users/seats to purchase.

When an employee exits:
- Their paid seat becomes available for another employee.
- The customer can replace that user without treating the exited user as a permanently consumed seat.

## 4.3 Invoice
- Invoice is **one per company**.
- Each company can have its own billing details/GST context.

## 4.4 Payment method
- Different companies can use different cards/bank accounts.
- For now, use **autopay only**.
- Invoice/bank-transfer workflows may be considered later.

## 4.5 Billing frequency
- Monthly billing: yes.
- Yearly billing: yes.
- Annual discount: may be applied.

## 4.6 Employee-count billing model
The client selected a **maximum-count / automatic-adjustment model**.

Example:

```text
Company buys HRMS for 10 employees.
Price = ₹500 per employee.
Autopay authorization = ₹5,000.

During the month:
10 → 11 employees

System:
- allows the additional employee according to the agreed model
- displays a clear message that the additional usage will be billed
- at month-end, calculates the extra employee usage
- charges the additional amount through the configured autopay
- next cycle reflects the new employee count
```

Important:
- Do not silently block the employee merely because the original prepaid quantity was exceeded.
- The user should understand that extra usage will be charged.
- The exact technical proration/accounting implementation still needs to be designed carefully.

## 4.7 Employee in multiple companies
If the same person exists in two companies:
- They are billed separately for each company.
- UnifiedTree does not attempt to combine/deduplicate the billing across companies.

## 4.8 Mid-month company/module/employee changes
Use the same maximum/usage billing principle described above.

The intent is:
- extra employees during the cycle are recognized;
- user sees a message;
- additional amount is collected through autopay;
- next billing cycle reflects the updated usage.

## 4.9 Free trial
The stated direction:
- Free access should initially cover all modules.
- Unlimited employees can be accessed during the trial.
- Autopay should be set up so that billing occurs automatically when the customer continues using the platform/employee seats.

**Still unclear:** exact trial duration and exact payment authorization flow.

## 4.10 Failed payment
Direction:
- The system should ultimately **lock everything** when payment is not completed.
- Admin/high-level users should receive prominent alerts that payment is required.

**Still unclear:** exact grace period and timing before lock.

## 4.11 Cancellation/data retention
Direction:
- Keep data long enough until the client requests a specific action.

**Still unclear:** exact retention period, export format, and legal policy.

---

# 5. HRMS PACKAGE MODEL

## 5.1 HRMS is one package
HRMS consists of:

- HR
- Attendance
- Leave
- Payroll

These should be sold as **one HRMS package**.

## 5.2 No partial HRMS purchase
Do not sell:

- Payroll alone
- Attendance alone
- Leave alone
- HR alone

The package is combined.

## 5.3 HRMS billing is independent
HRMS has its own billing.

Other future modules should have separate billing.

Example:

```text
Company A
 ├── HRMS subscription → separate billing
 ├── Future CRM subscription → separate billing
 └── Future Marketing subscription → separate billing
```

---

# 6. PURCHASE PERMISSIONS

The Owner is the primary authority.

However:
- Owner can grant another user permission to purchase/manage modules.
- Roles and responsibilities should be configurable in **Business Settings** (currently called workspace settings).
- The goal is to prevent the Owner from having to perform every operational action personally.

The same delegation principle applies to administration where appropriate.

---

# 7. SELF-SERVICE / APPROVAL MODEL

The client direction is leaning toward:

> **Self-service only.**

However, this item was explicitly marked as something that should be explained properly before final confirmation.

Working interpretation:
- New businesses should be able to sign up themselves.
- Company creation/purchase should be self-service according to permissions.
- UnifiedTree should not manually approve every ordinary signup/purchase unless a compliance/business rule requires it.

**Status: PARTIAL / NEEDS FINAL CLIENT CONFIRMATION.**

---

# 8. COMPANY ACCESS & ROLE MODEL

This is a major confirmed requirement from the 4 Oct meeting.

## 8.1 Common login
A user has a common login.

Billing is separate per company.

## 8.2 Company-specific access
A person's access must be represented by company.

Example:

```text
Manager A
 ├── Company 1 → Manager
 ├── Company 2 → Manager
 ├── Company 3 → Employee
 ├── Company 4 → No access
 └── Company 5 → Manager
```

The user should only see/manage the companies they are permitted to access.

## 8.3 Multi-company manager
If a manager is granted management access to 5 companies:
- all 5 companies should be visible/available to that manager;
- this must work in both **web and mobile app**.

## 8.4 Access administration
- Admin should be able to grant company access.
- Employee details should contain an Access/Roles area.
- There should also be a separate **Roles & Access** page.
- A user's role/access should be understandable from either location.

---

# 9. GLOBAL COMPANY SWITCHING

This is confirmed.

The company selector is global.

When a user switches company:

```text
Current Company: Company A
        ↓
Switch to Company B
        ↓
Every relevant HRMS page now shows Company B data
```

Do not make each page maintain a separate independent company selection unless explicitly required later.

---

# 10. LOGIN / DOMAIN / ROUTING

## 10.1 Main business URL
The intended structure is:

```text
business.unifiedtree.com/hrms
```

Use the actual business identifier/subdomain pattern used by the implementation.

## 10.2 Companies do not receive URLs
Do NOT create:

```text
companyA.unifiedtree.com
companyB.unifiedtree.com
```

Company switching is data/context based.

## 10.3 One business login
The intended login model is:
- one business login;
- after login, user enters their business/app dashboard;
- HRMS is accessed from the business app/module context.

## 10.4 Website Login
The main website's Login button should open the business's application/modules dashboard as currently intended.

## 10.5 Existing URLs
Old addresses should continue working.

Do not break existing bookmarks/invitation/password-reset links unnecessarily.

## 10.6 Login methods
Confirmed:
- Mobile number
- Email + password
- Continue with Google

Do not add Microsoft or mobile OTP unless separately approved.

## 10.7 Business login image
- One login image per business.
- Not one per company.
- A separate branded login page can be introduced later.

---

# 11. SETTINGS MODEL

Confirmed design principle:

## Business / Workspace settings
Overall settings belong on the modules launcher/business dashboard.

Examples:
- Business details
- Branding
- Users
- Roles
- Billing
- Overall business configuration

## Module settings
Each module has **one main settings entry**.

Example:

```text
Modules Dashboard
 └── Overall / Business Settings

HRMS
 └── HRMS Settings

Future CRM
 └── CRM Settings

Future Marketing
 └── Marketing Settings
```

Do not create multiple confusing settings locations inside the same module.

---

# 12. OWNERSHIP TRANSFER

A new ownership-transfer workflow is required.

Intent:

1. New owner receives new login/access.
2. Business ownership/data/control is transferred.
3. Old owner enters a transition period.
4. Old owner may guide the new owner during the transition.
5. Transition period can be up to approximately **15 days**.
6. After the transition period:
   - old owner's full access is removed;
   - new owner becomes the effective owner.

Exact implementation/security details need to be designed.

---

# 13. HRMS UI / UX REQUIREMENTS

Primary design references:
- **Keka** for HRMS patterns.
- **NextWave** for face punch/enrollment flows.
- **My Bill Book** for calendar/date-range patterns.

## 13.1 Dashboard
- Reduce dashboard spacing by approximately 10%.
- Existing/old HRMS font is acceptable.
- Use full name in greeting, not only the first name.
- At minimum, greeting should not be incorrectly reduced to a single first-name token.

## 13.2 Module navigation
- Module sub-sections should appear as top navigation/tabs.
- Do not use a large left-side "Pages" panel for module sub-sections.
- Page-specific subsections should remain inside their respective page.

## 13.3 Roles & Access
- Separate Roles & Access page.
- Access should also be available wherever the employee is viewed.
- Employee details should show role and access.
- New roles should be addable inline instead of forcing the user to select only predefined roles.

## 13.4 Global search
Global search should cover everything the user is allowed to access, including as applicable:
- People
- Pages
- Requests
- Payslips
- Documents
- Letters
- Policies
- Settings
- Other searchable HRMS entities

Permission boundaries must remain enforced.

## 13.5 Calendar
Calendar redesign should use Keka as a reference.

Requirements include:
- Dashboard calendar redesign.
- Predefined date-range options.
- Start/end date selection.
- Public holiday visibility.
- Sick leave visibility.
- Upcoming events.
- Birthday and retirement-related date filtering.

Original examples:
- birthdays in the next month;
- retirements in the next 6 months.

The exact six predefined ranges were discussed with My Bill Book as a reference but were not definitively enumerated in the client answers.

## 13.6 Upcoming events
Rename/replace "Upcoming Milestones" with **Upcoming Events**.

---

# 14. ATTENDANCE / FACE PUNCH

## 14.1 Web face enrollment
Web must support face enrollment.

Use **NextWave** as the visual/flow reference.

## 14.2 Web face punch
Web punch-in with face scan is required.

## 14.3 Manager punch
Manager should be able to punch in for employees using face punch functionality where the role/flow permits it.

## 14.4 Common face-punch station
A common face-punch mode is desired so employees can punch without using their own phones.

After a successful punch:
- employee details should be shown;
- success state should be clear;
- manager should be able to manually approve where required.

Exact approval/security workflow still needs implementation design.

## 14.5 Daily tracking
Face punches should be viewable in calendar-wise data.

---

# 15. LEAVE

Required/mentioned:
- Leave approvals.
- Bulk approvals.
- HR-level approvals.
- All balances.
- Apply on behalf of employee.
- Calendar view.
- Sick leave should be visible in calendar.

---

# 16. SHIFTS & OVERTIME

## 16.1 Overtime
Client wants configurable OT rules.

Example:
- 30 minutes or 1 hour can be configured as the threshold.
- Admin decides what amount of extra time qualifies as OT.

OT should support:
- timing types;
- calendar-wise selection;
- configurable rules.

Potential timing types mentioned:
- Before shift
- After shift
- Weekly off
- Holiday

These examples are from the earlier question and should be confirmed if needed.

## 16.2 Shift planning
Requirements mentioned:
- Shift customization.
- Full shift planning page.
- 2+2+2+1 rotational pattern concept.
- Bulk employee import.
- Bulk assignment.
- Date-to-date planning.
- Number of shifts.
- Custom shift creation.
- Holiday assignment.
- Employee-category counts.
- Scheduling.
- Employee shift interchange.
- Shift swap requiring appropriate approval and acceptance.
- Rotational shifts.

The exact meaning of "2+2+2+1" is still a business rule to confirm.

---

# 17. EMPLOYEES / ONBOARDING

Requirements:
- Add employee.
- Onboarding.
- Employee details/profile.
- Employee role/access.
- Inline role creation.
- Inline master-data creation.
- Employee import.

## Inline Create status
Inline Create on Add Employee was completed and browser-tested.

It supports Create beside:
- Branch
- Department
- Designation
- Employment Type
- Shift
- Staffing Agency
- Roles in the Access step

Behavior:
- Opens a side panel.
- Uses the master form.
- Escape closes the panel without losing entered employee data.
- Newly created department is selected immediately.
- Without permission, Create is visible but disabled with an explanatory message.

Tests at the time of the note:
- Type check passed.
- Production build passed.
- 779/779 unit tests passed.

Still required:
- Real-backend/live verification after merge.

Important known issue:
- Master-page Add buttons for Departments, Shifts, etc. were creating records in the **first company** in a multi-company workspace.
- Inline Create correctly used the current company.
- This master-page company-scoping issue must be fixed before considering multi-company behavior complete.

---

# 18. EMPLOYEE CODE / MULTI-COMPANY DATABASE ISSUE

A real multi-company issue was found.

Current problem:
- Database constraint was described as unique on:
  `UNIQUE (tenant_id, employee_code)`
- Employee-code generation was keyed by `company_id`.

Result:
```text
Company A → EMP-0001
Company B → EMP-0001
```

Database rejects the second one because the workspace-wide constraint sees a duplicate.

Two possible designs were identified:

### Option A — Tenant-wide employee codes
One sequence for the whole workspace.

Example:
```text
Company A → EMP-0001
Company B → EMP-0002
```

### Option B — Company-specific employee codes
Change uniqueness to:

```text
(tenant_id, company_id, employee_code)
```

Example:
```text
Company A → EMP-0001
Company B → EMP-0001
```

The previous recommendation leaned toward **Option B** because it matches company-level independence.

**Important:** Do not implement this blindly if the final product decision has not been recorded elsewhere. Confirm the current code/database state before migration.

---

# 19. PAYROLL / MONEY / EXPENSES

Planned release scope includes:
- Payroll dashboard
- Payroll runs
- Salary structures
- Payroll settings
- Bank
- Expenses
- PLI
- Advances
- Full & Final settlement
- My payslips & salary

Later rules mentioned but not necessarily in immediate launch:
- TDS
- OT pay
- Payslip on hold

Do not invent business rules for these.

---

# 20. REPORTING / ANALYTICS — FUTURE REQUIREMENTS

The client later mentioned interest in:

- Employee scoring
- Employee analytics
- Detailed employee reports
- Leave patterns
- Work management
- Employee report card / full-profile report
- Team productivity
- Team/department comparisons
- Operational team vs sales team performance

These are requirements/ideas to preserve, but they are not all defined enough to implement as exact specifications.

---

# 21. APP ↔ WEB PARITY

A strong product requirement is:

> Everything the app contains should also be available on the web.

App-related requirements mentioned:

- Notification badge currently shows a count but notification list may be empty.
- Admin payment should be possible in the app.
- Upcoming milestones → Upcoming Events.
- Face verification reset + push notification + re-enrollment.
- Full-name greeting.
- Dark and light themes.
- Maps alternative.
- Face enrollment using NextWave reference.
- Page Not Found screen.
- Alerts page containing two tabs:
  - Notifications
  - Messaging/Communicator
- Roles should be addable inline.
- App/web synchronization needs to be discussed and verified.

---

# 22. APP-SPECIFIC STATUS / LATER SCOPE

The broader mobile scope from the working plan includes:

- Notification badge bug.
- Page-not-found screen.
- Full name.
- Upcoming Events.
- Add role inline.
- Alerts: notifications + messaging.
- Face reset with push + re-enrollment.
- NextWave enrollment.
- Dark/light theme.
- Maps alternative.
- Admin payment.
- Web/app synchronization.

The mobile app was explicitly said to be discussed later in the client decisions.

---

# 23. DESIGN REFERENCES

## Keka
Use Keka as reference for:
- Login page
- Manager view
- Calendar
- Rules & Policies
- Org tree
- Roles & Access patterns
- HRMS dashboard patterns
- Upcoming Events / milestones patterns

## NextWave
Use NextWave as reference for:
- Face enrollment
- Web face punch-in
- Face verification flow

## My Bill Book
Use as reference for:
- Calendar date presets
- Start/end date selection

---

# 24. SAVED DASHBOARD DESIGNS

Two saved dashboard design variants exist.

## Header A — outlined pills
- Each section tab is an outlined pill.
- Active section becomes solid green.
- Search has a round green button.

## Quick Actions A — animated tile row
- Six large animated tiles sit directly under the stat cards.

These designs were saved and were not removed.

They can be restored through the dashboard tweak configuration:
- Header → `A: outlined pills`
- Quick actions → `A: tile row`

A combined preview was saved as:
- `SavedHeaderTiles.dc.html`

The default dashboard noted in the saved-design note remains:
- dark green header
- wide stat cards
- icon dock

---

# 25. CURRENT REDESIGN / RELEASE PLAN

Reference working plan: `PHASES.md`.

## Release 1 — Already live
Live:
- New look
- Sidebar
- Header
- More panel
- Dashboard

## Release 1.1
Target:
- Old/approved HRMS font
- Module sub-pages as top tabs
- No left Pages panel
- Page subsections inside page
- Dashboard ~10% more compact
- Full-name greeting

## Release 2 — Daily-use HRMS
Target:
- Team
- Manager view
- Approvals + Undo
- Reminders
- Probation
- Message Team
- Attendance
- Daily tracking
- Web face punch
- Face scan
- Face punches by calendar
- Breaks
- Timesheet
- Leave approvals
- Leave balances
- Apply on behalf
- Leave calendar
- Shifts
- Overtime
- Home / My Day
- Needs You
- My Requests
- Upcoming Events

## Release 3 — People & Access
Target:
- Roles & Access
- Access tab on every employee
- Add role inline
- Employee profile
- Add employee
- Import
- Onboarding
- Hiring
- Assets
- Keka-style org tree
- Calendar presets
- Keka-style dashboard calendar
- Global search
- Notification popover

## Release 4 — Pay & Money
Target:
- Payroll
- Salary structures
- Payroll settings
- Bank
- Expenses
- PLI
- Advances
- Full & Final
- Payslips
- Salary
- Dashboard quick-action customization

## Release 5 — Remaining HRMS
Target:
- Rules & Policies
- Master overview
- Org setup
- Letters & Documents
- Logo/letterhead/template previews
- Performance
- Learning
- Exit
- Reports & Analytics
- HR configuration
- Notification templates
- Integrations
- App-to-web gaps

## Release 6 — Workspace / Settings / Website
**PAUSED until product/client decisions are finalized.**

Target:
- One workspace per sign-up
- Companies inside HRMS
- Workspace settings on module launcher
- One settings entry per module
- Users
- Roles
- Audit logs
- Companies & branches
- Keka-style login
- HRMS-specific pricing
- Sign-up wording

## Release 7 — Final go-live
- Full regression
- Light/dark/phone checks
- Production DB-change checklist
- Push
- Live verification

## Release 8 — Shift Planning
Later:
- Rotations
- Planning wizard
- Bulk import/assign
- Shift swaps
- Rotational shifts

## Release 9 — Mobile App
Later:
- App-specific fixes and parity work

## Release 10 — Kept for later
Examples:
- Optional/branch holidays
- Comp-off
- Unpaid leave beyond balance
- Payslip on hold
- TDS
- OT pay
- Alternate Saturdays
- Probation auto-extension
- More notification events
- Profile self-edit
- Integrations
- Invoices
- Course learning
- Report builder
- Kudos

## Release 11 — New products
Separate projects:
- Wallet
- Marketing automation
- Hospitals

---

# 26. TESTING / RELEASE PROCESS

Every release should pass the full test gate:

1. Type check.
2. Unit tests.
3. Production build.
4. 55-script regression against baseline.
5. Package-specific live test.
6. Light mode check.
7. Dark mode check.
8. Phone/mobile layout check.
9. Database-change checklist.
10. Production verification.

Rule:

> **No backend API should ship without its corresponding usable screen.**

Production database migrations should be explicitly listed and applied in the correct order.

---

# 27. BUG REPORTING WORKFLOW

Daily tester input should be one row per problem.

Recommended Google Sheet columns:

| Date | Tester | Web/App + Phone Model | Workspace | Role/Login | Page/Screen | Steps | Expected | Actual | Screenshot/Video | Severity |
|---|---|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | Name | Web / App | Business | Role | Page | Steps | Expected result | Actual result | Link | Blocker/Major/Minor |

Process:
- New rows arrive by approximately 6 PM.
- Blockers are handled immediately.
- Remaining issues are batched twice daily.
- After each release, testers are told what is ready to re-test.

---

# 28. CURRENT IMPLEMENTATION / VERIFIED FIXES

## Leave / Shifts company-list error
A previously observed issue was traced to unauthorized requests for the full company list.

Behavior:
- Employee/manager pages were asking for all companies.
- Server returned 403.
- App silently fell back to the user's own company.
- Pages were not actually empty, but every load produced an error and unnecessary work.

Fix:
- App only requests the full company list if the user is authorized.
- Others receive their own company directly.
- HR retains full-company visibility.
- Browser checks for employee and manager showed:
  - no refused requests;
  - no console errors;
  - correct leave types;
  - correct shifts.

At the time of the note:
- 790 unit tests passed, including 11 new tests.

## Production permission drift
A migration (`V065`) was described as granting `org.company.read` to:
- Employee
- Dept Manager
- Manager

Production did not have that permission for those roles.

Important:
- This suggests migration drift/manual production changes.
- A structure-only database diff will not catch permission-data differences.
- Permission comparison should include `rbac.role_permissions`.

## Flyway / migration state
Production had no reliable migration history in the referenced investigation:
- Flyway was off.
- Canonical migration history was empty in the referenced check.
- Several migrations had been manually applied.

Recommended safe procedure:
1. Build an empty Postgres with canonical migrations through the known production baseline.
2. Run schema-only dump on fresh DB.
3. Run schema-only dump on production using read-only access.
4. Diff them.
5. Compare role permissions as well as structure.
6. Fix gaps.
7. Only then baseline Flyway.
8. Do not baseline before the diff.

---

# 29. SECURITY / MALWARE CONTEXT

A previous malware incident was documented.

Recorded actions:
- 15 hidden tasks removed.
- 4 hidden settings removed.
- Associated folders removed.
- Startup items were checked.
- Defender scan was running.
- The exact infection path was not identified.

Security actions that were recommended:
- Block malicious servers/domains at the administrator level.
- Generate new GitHub recovery codes if old recovery codes existed during the incident.
- Change passwords/tokens for:
  - Google
  - GitHub
  - Vercel
  - Razorpay
  - Claude
  - database credentials
- Prefer doing sensitive password changes from a trusted phone/PC.
- Consider Defender Offline scan.
- Consider Windows reset after backup.

**Do not put actual passwords, tokens, recovery codes, or private keys in this master document.**

---

# 30. DATABASE ACCESS NOTE

A production Cloud SQL/Auth Proxy setup was documented in the source notes.

The actual command and database connection details existed in the original file, but credentials are intentionally omitted from this master file.

If database access is required:
- retrieve the current credentials securely from the approved secret store;
- never copy them into prompts, Git, Markdown, or chat;
- use read-only access for inspection whenever possible;
- rotate any credential that was previously exposed in plaintext notes.

---

# 31. EXISTING DATABASE / COMPANY CODE ISSUE

When adding an employee to a second company, an `EMP-0001` collision was observed.

Root cause identified in the notes:

```text
Unique constraint:
(tenant_id, employee_code)

Employee-code generator:
company_id scoped
```

This is inconsistent.

Before implementing:
- inspect current canonical migrations;
- inspect current production constraint;
- inspect existing employee codes;
- decide company-scoped vs workspace-scoped employee codes;
- write migration;
- test with at least two companies;
- test employee creation concurrently if relevant.

---

# 32. CLIENT QUESTIONS STILL BLOCKING / NEEDING FINAL ANSWERS

These are the important questions that were not fully answered in the provided notes.

## Q1 — Self-service / approval
**Should business signup, company creation and purchases be completely self-service, or does UnifiedTree need to approve some/all of them?**

Current direction: self-service.

Need final answer:
- Are there any manual approval checkpoints?
- If yes, exactly which events?

## Q2 — Employee-count billing
The broad billing model is decided, but implementation details remain.

Need final confirmation:
- Exact billing-period calculation.
- Exact maximum-count calculation.
- How annual plans calculate extra usage.
- What happens if employee count decreases later in the same cycle.
- Exact autopay authorization/amount behavior.

## Q3 — Free trial
Confirmed direction:
- all modules;
- unlimited employees;
- automatic billing after continued usage.

Still needed:
- Trial length.
- Whether payment method is mandatory at signup.
- Exact moment billing begins.

## Q4 — Failed payment
Confirmed:
- ultimately lock everything;
- alert admin/high-level users.

Still needed:
- Number of grace days.
- Warning schedule.
- Whether there is a final read-only state before lock.
- What happens to payroll in the middle of a payroll run.

## Q5 — Cancellation/data retention
Confirmed:
- retain data until client requests a specific action.

Still needed:
- Exact retention period.
- Export availability.
- Export format.
- Deletion process.

## Q6 — Discounts
Still unanswered:
- Multi-company discount?
- Bundle discounts?
- Coupon codes?
- Other promotions?

## Q7 — Refund / Terms / Privacy
Still unanswered:
- Refund policy.
- Terms of service owner.
- Privacy policy owner.
- Exact published pages required for Razorpay/business compliance.

## Q8 — Combined reporting
**Answered: No combined reports across all companies are required.**

Do not build combined company payroll/headcount reporting unless a new requirement appears.

## Q9 — Shared HRMS policies
**Answered: Not required.**

Do not assume holidays, leave policies, shifts or roles are globally shared across companies.

Treat them as company-specific unless another explicit requirement says otherwise.

## Q10 — Employee transfers
**Answered: Not required as a special workflow.**

Client can:
- exit employee from one company;
- add them to another.

Do not build a dedicated transfer-history workflow unless requested later.

## Q11 — Mobile app structure
Still deferred:
- one app vs multiple apps;
- per-module app strategy;
- white-label app strategy.

Discuss later.

## Q12 — Existing multiple-workspace production accounts
The old architecture allowed multiple workspaces per account.

Need to verify production:
```sql
select account_id, count(*)
from platform.account_workspaces
group by 1
having count(*) > 1;
```

Suggested safe approach from the earlier analysis:
- existing accounts with multiple workspaces may continue working;
- prevent creation of new additional workspaces;
- do not destroy existing production data without explicit migration planning.

## Q13 — Invited user ownership
Earlier recommendation:
- a person should be able to own their own business and also be invited into another business.

This was suggested but not explicitly confirmed in the client answer set.

## Q14 — Signup wording
Direction:
- "Company name" → "Business name".

Confirm before final UI copy if not already approved.

## Q15 — Companies & Branches location
Direction:
- HRMS → Organization Setup → Companies & Branches.

Confirm before final navigation migration if not already implemented.

## Q16 — ADMIN permission scope
An earlier implementation discussion identified three permissions:
- `hrms.team.message`
- `hrms.probation.team.decide`
- `hrms.timesheet.approve`

The open question was whether ADMIN should be a full deputy to Owner or intentionally weaker.

Do not silently change role permissions without checking the current agreed RBAC model.

---

# 33. INTERNAL IMPLEMENTATION QUESTIONS — NOT CLIENT QUESTIONS

These should be solved by the development team, not repeatedly sent to the client.

Examples:

- How exactly to implement company-scoped billing records.
- How to represent global current-company context.
- How to enforce one-workspace-per-account server-side.
- How to migrate employee-code uniqueness.
- How to model company-scoped permissions.
- How to implement billing usage reconciliation.
- How to preserve old URLs.
- How to run DB migrations safely.
- How to compare production permissions with canonical migrations.
- How to make master-data creation company-aware.
- How to test web/app parity.
- How to structure release branches and deployment gates.

---

# 34. RECOMMENDED PRODUCT WORKFLOW FROM CONFIRMED DECISIONS

The implementation should now be thought of in this order.

## Stage A — Freeze the product model
Implement/verify:

```text
Account
  ↓
One Business / Workspace
  ↓
Business settings + modules + billing
  ↓
HRMS
  ↓
Companies
  ↓
Branches
  ↓
HRMS data
```

Do not start white-label architecture yet.

## Stage B — Company context
Implement one reliable global company context.

Every HRMS request/page should derive its company scope consistently.

Verify:
- employee list;
- attendance;
- leave;
- shifts;
- payroll;
- settings;
- reports;
- master pages;
- employee creation.

## Stage C — Company-specific access
Implement:
- user → company access mapping;
- role per company where required;
- admin ability to grant access;
- company list restricted by permission;
- web + mobile consistency.

## Stage D — Billing
Implement:
- company-level subscription;
- HRMS package;
- employee-seat pricing;
- monthly/yearly plans;
- autopay;
- usage tracking;
- extra employee billing;
- invoices per company;
- company-specific payment method;
- payment failure lock;
- billing alerts.

Do not finalize billing code until the remaining billing questions are answered.

## Stage E — Business settings
Implement:
- business details;
- branding;
- users;
- roles;
- billing;
- overall settings.

Keep HRMS settings inside HRMS.

## Stage F — Login / routing
Implement/verify:
- business login;
- business URL;
- old URL compatibility;
- website login → business app dashboard;
- mobile/email/password/Google sign-in.

## Stage G — HRMS UX
Complete:
- Keka-inspired manager view;
- roles/access;
- calendar;
- face punch;
- attendance;
- leave;
- shifts/OT;
- employee onboarding;
- payroll;
- reports.

## Stage H — App parity
For every important web feature:
- verify app behavior;
- identify gaps;
- implement parity.

## Stage I — Migration / production
Before production:
1. Back up DB.
2. Compare schema.
3. Compare migration history.
4. Compare permissions.
5. Apply migrations in order.
6. Test with at least two companies.
7. Test company switching.
8. Test billing isolation.
9. Test role isolation.
10. Test payment failure.
11. Test old URLs.
12. Run complete regression.

---

# 35. RELEASE PRINCIPLES

Use these principles for every coding agent:

### 1. Do not guess business rules
If the requirement is marked pending, stop and identify the exact question.

### 2. Do not break company isolation
Every company-scoped operation must use the current authorized company.

### 3. Do not trust frontend-only permissions
Authorization must be enforced server-side.

### 4. Do not introduce a second settings system
Keep business settings and module settings clearly separated.

### 5. Do not build white-label now
Keep the architecture extensible, but do not spend current launch time implementing it.

### 6. Do not ship backend-only features
A usable UI must accompany backend APIs.

### 7. Test real multi-company behavior
A single-company test database is insufficient.

Minimum multi-company test:

```text
Business
 ├── Company A
 │    └── EMP-0001
 │
 └── Company B
      └── EMP-0001
```

Then verify:
- no collision if company-scoped codes are chosen;
- correct company filtering;
- correct permissions;
- correct billing;
- correct switching.

---

# 36. WHITE LABEL — DEFERRED TO NEXT PLANNING STAGE

**This section is intentionally at the end. Do not make white-label work part of the immediate HRMS launch unless explicitly reactivated.**

White-label was identified as a large architecture/business decision.

Open questions:

## W1 — Who is white-label for?
- Reseller selling UnifiedTree under their own brand?
- Large customer wanting its own branding?

These are different commercial/technical models.

## W2 — Infrastructure model
- Same system with different branding?
- Separate system/database per white-label customer?

## W3 — What is rebranded?
Potentially:
- Logo
- Colors
- Domain
- Email sender
- Payslips
- Letter PDFs
- Mobile app name
- Mobile app icon
- "Powered by UnifiedTree"

## W4 — Timing
- When is the first white-label client expected?

## W5 — Reseller pricing
- Can resellers set their own price?
- Does UnifiedTree bill them wholesale?
- Is there a partner/reseller billing layer?

## W6 — State-wise model
A later note mentioned:
- one head/person per state;
- state-wise data visibility/management.

This needs its own product definition and should not be assumed to be the same thing as white-label.

---

# 37. OTHER FUTURE PRODUCTS

## Wallet
Earlier meeting notes mentioned:
- Wallet for payments.
- Separate/both-way payment flows.

Not part of immediate HRMS launch.

## Marketing Automation
Ideas mentioned:
- Upload one video.
- Publish one template to multiple social media platforms.
- Meta Pixel integration to capture website-related data.
- Meta policy compliance.
- Need to investigate advertising-related requirements.

Not part of immediate HRMS launch.

## Hospitals
**On hold.**

Requirement:
> Hospital work remains on hold until HRMS and WhatsApp are submitted/delivered.

---

# 38. CLIENT MEETING HISTORY — IMPORTANT CONTEXT

## 27 Sep 2026
Key HRMS changes:
- HRMS pricing separate on main website.
- HRMS purchase separate.
- Dashboard spacing reduction.
- Existing HRMS font acceptable.
- Top module subsections instead of left Pages panel.
- Upload previews for logo/letterhead/templates.
- Employee roles/access.
- Keka-style designation hierarchy.
- OT customization.
- Shift planning/customization.
- Bulk shift import/assignment.
- Calendar-wise face punches.
- Six calendar date presets concept.
- App role creation.
- Page-not-found screen.
- Alerts with Notifications + Messaging.
- Upcoming Milestones → Upcoming Events.
- Hospital health classification idea.

## 30 Sep 2026
- Hospital held until HRMS + WhatsApp delivered.
- Keka manager reference.
- Roles & Access page.
- Access wherever employee is shown.
- Web face punch with NextWave reference.
- Keka calendar reference.
- Keka Rules & Policies reference.

## 1 Oct 2026
- Move from multiple workspaces to one business/workspace.
- Multi-company inside HRMS.
- Keka login reference.
- Detailed architecture investigation of current workspace/company model.

## 4 Oct 2026
Major client answers:
- Company-specific roles/access.
- Manager can access multiple companies.
- Autopay only for now.
- Maximum employee usage drives billing.
- Mid-cycle additional users billed.
- Same employee in multiple companies billed separately.
- Free-trial direction.
- Failed payment ultimately locks.
- Data retained until client asks.
- No combined cross-company reports.
- No shared HR settings requirement.
- No special employee-transfer workflow.
- Mobile architecture deferred.
- Ownership transfer workflow.
- Public holiday/calendar behavior.
- Owner can delegate full admin access.
- Common face-punch station.
- Company access visible.
- Employee analytics/reporting ideas.

---

# 39. WHAT CLAUDE/CODE AGENTS SHOULD DO FIRST

When starting work from this file:

## First
Read this entire document.

## Second
Inspect the actual repository and determine:
- what is already implemented;
- what is live;
- what is partially implemented;
- what is mock/static;
- what is unreachable/dead code;
- what database migrations already exist;
- what APIs actually execute;
- what UI routes actually render.

## Third
Compare implementation against this document.

Create a gap list:

```text
CONFIRMED + IMPLEMENTED
CONFIRMED + PARTIALLY IMPLEMENTED
CONFIRMED + NOT IMPLEMENTED
PENDING CLIENT DECISION
INTERNAL ENGINEERING DECISION
DEFERRED / LATER
BROKEN / REGRESSION
```

## Fourth
Do not rewrite working functionality just because the architecture could be cleaner.

Fix the highest-impact product gaps first.

---

# 40. CURRENT PRIORITY

Immediate focus:

1. HRMS launch readiness.
2. Multi-company correctness.
3. Company-scoped permissions.
4. Billing model clarification/implementation.
5. Login/business/workspace model.
6. HRMS UI/UX.
7. Web face punch/enrollment.
8. Employee roles/access.
9. Calendar.
10. App/web parity.
11. Production migration safety.
12. Full regression.

**Do not prioritize:**
- White-label implementation.
- Hospital module.
- Wallet implementation.
- Marketing automation implementation.

unless the project owner explicitly changes priority.

---

# 41. SOURCE-OF-TRUTH RULE

If two notes conflict:

1. Prefer the **latest explicit client decision**.
2. Prefer a direct confirmed decision over an earlier question.
3. Treat internal recommendations as recommendations, not requirements.
4. Treat old notes as historical context.
5. If still ambiguous, flag the ambiguity instead of guessing.

---

# 42. IMPORTANT SECURITY RULE FOR THIS DOCUMENT

Never add:
- Database passwords
- API keys
- Razorpay secrets
- GitHub recovery codes
- OAuth client secrets
- JWT secrets
- Cloud credentials
- Personal passwords

If Claude needs a secret:
- tell Claude which environment variable/secret name to use;
- retrieve the secret through the approved environment/secret manager;
- never paste the value into this Markdown file.

---

# 43. FINAL WORKING STATE

The project is currently in a transition from:

```text
Account
 └── Multiple Workspaces
       └── Companies inside HRMS
```

to:

```text
Account
 └── ONE Business / Workspace
       ├── Business Settings
       ├── Billing
       ├── Users / Roles
       └── HRMS
             ├── Company A
             ├── Company B
             └── Company N
```

The **product model is substantially defined**.

The biggest remaining blockers are:
- exact billing edge cases;
- final self-service/approval confirmation;
- payment-failure timing;
- trial details;
- cancellation/data-retention details;
- discounts;
- refund/legal ownership;
- a few internal RBAC/workspace migration decisions.

Everything else should be treated as implementation planning against the confirmed model rather than repeatedly reopening the already-decided architecture.

---

# 44. HANDOFF INSTRUCTION FOR CLAUDE

When this file is provided to Claude, Claude should respond to the project as follows:

> You are working on the UnifiedTree SaaS/HRMS project. This Markdown file is the current project context and product specification. Read it completely before editing code.
>
> Do not treat pending questions as requirements.
>
> Do not invent business rules.
>
> Do not implement white-label, Hospitals, Wallet, or Marketing Automation unless explicitly instructed.
>
> Preserve company-level data isolation and server-side authorization.
>
> Before making large architectural changes, inspect the actual repository, database migrations, routes, APIs, and live implementation.
>
> For every task, identify whether it is:
> 1. confirmed requirement,
> 2. pending client decision,
> 3. internal engineering decision,
> 4. bug/regression,
> 5. future/deferred scope.
>
> Then implement the smallest safe change that moves the project toward the confirmed model.
>
> Always test multi-company behavior, permissions, current-company context, and production migration safety where relevant.