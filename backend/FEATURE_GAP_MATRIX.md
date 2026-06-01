# UnifiedTree HRMS - Feature Gap Matrix

Source: client repo aniledulakanti24/unified-tree-hr-dashboard (deployed at https://aniledulakanti24.github.io/unified-tree-hr-dashboard/)

Mapping every page in the client template to the current backend state. Used as the parity gate for "feature complete."

Legend
- DONE: schema applied + entity mapped + service implemented + REST endpoint live + verified by smoke test
- SCHEMA: canonical SQL exists, no Java code yet
- PARTIAL: some code exists but missing parts of the client page (forms, columns, actions)
- MISSING: nothing in canonical layer yet (may exist on legacy `public.*` tables)
- N/A: aggregated view or read-only summary, no new tables required

Phases
- P1: canonical auth + RBAC code (close X-Tenant-ID footgun)
- P2: canonical attendance + leave entities/services/REST
- P3: rules + policies + notification templates + integrations + audit writer
- P4: HRMS frontend wiring (after backend foundations stop shifting)
- P5: recruitment, payroll, expense, performance, compliance, reports, exit

---

## Module 1: Company Profile

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Companies & Branches list + manage | DONE | DONE | DONE | DONE | MISSING | P4 | `/v1/hrms/companies`, `/v1/hrms/branches` |
| Branch Geofence editor (lat/lon/radius/recenter) | DONE | DONE | DONE | DONE | MISSING | P4 | `PUT /v1/hrms/branches/{id}/geofence` |
| Multi-branch employee distribution counts | DONE | DONE | PARTIAL | PARTIAL | MISSING | P4 | denormalized `employee_count_cached` exists; recalc job not wired |

## Module 2: Dashboard

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Total/Present/On Leave/Late KPIs | N/A | N/A | MISSING | MISSING | MISSING | P4 | aggregation queries over attendance + leave canonical |
| Weekly Attendance Trend chart | N/A | N/A | MISSING | MISSING | MISSING | P4 | blocked by P2 attendance canonical |
| Daily Overview, Dept Distribution | N/A | N/A | MISSING | MISSING | MISSING | P4 | |
| Top Performers widget | N/A | N/A | MISSING | MISSING | MISSING | P5 | blocked by performance module |
| Onboarding Tracker | N/A | N/A | MISSING | MISSING | MISSING | P5 | blocked by recruitment module |
| Recruitment & Pipeline KPIs | N/A | N/A | MISSING | MISSING | MISSING | P5 | blocked by recruitment module |
| Projects & Productivity panel | N/A | N/A | MISSING | MISSING | MISSING | P5 | out of scope for HRMS - placeholder |
| Payroll vs Budget chart | N/A | N/A | MISSING | MISSING | MISSING | P5 | blocked by payroll module |
| Live Activity Feed | N/A | N/A | MISSING | MISSING | MISSING | P3 | depends on audit writer in P3 |
| Birthdays/Anniversaries/Retirements | N/A | N/A | MISSING | MISSING | MISSING | P4 | derivable from hrms.employees DOB + DOJ |
| AI & Predictive Insights | N/A | N/A | MISSING | MISSING | MISSING | P5+ | out of phased scope; future ML add-on |

## Module 3: Master Data

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Workforce Directory: Employee Master tab | DONE | DONE | DONE | DONE | MISSING | P4 | `/v1/hrms/employees` with filters dept/branch/status/search |
| Workforce Directory: Contractor Master tab | DONE | DONE | DONE | DONE | MISSING | P4 | `/v1/hrms/contractors` |
| Workforce Directory: Classification Rules tab | DONE | DONE | DONE | DONE | MISSING | P4 | `/v1/hrms/classifications` |
| Organization Setup: Departments | DONE | DONE | DONE | DONE | MISSING | P4 | `/v1/hrms/departments` |
| Organization Setup: Designations (L1-L6 grades) | DONE | DONE | DONE | DONE | MISSING | P4 | `/v1/hrms/designations` |
| Rules & Policies: Shift Types | SCHEMA | MISSING | MISSING | MISSING | MISSING | P3 | `attendance.shift_policies` table exists |
| Rules & Policies: Leave Types | SCHEMA | MISSING | MISSING | MISSING | MISSING | P3 | `leave_mgmt.leave_types` table exists |
| Payroll Configuration: Salary Components | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | no payroll schema yet |

## Module 4: Attendance & Time

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Attendance Analytics dashboard | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | canonical schema + partitions ready; legacy code on `public.attendance_*` |
| Daily Logs (punch in/out) | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | `attendance.records` partitioned by month |
| Face Punch Logs | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | `attendance.event_logs` partitioned |
| Regularization requests | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | `attendance.regularization_requests` table exists |
| Shift Roster | SCHEMA | MISSING | MISSING | MISSING | MISSING | P3 | `attendance.employee_shift_assignments` |
| Overtime Approvals | SCHEMA | MISSING | MISSING | MISSING | MISSING | P3 | needs OT calc + approval workflow |
| Attendance Calendar view | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | derive from records by date |
| Manual punch button | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | endpoint TBD |

## Module 5: Leave Management

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Leave Operations Center: Applications & Approvals | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | `leave_mgmt.leave_requests` table exists with status enum |
| Balances & Comp-offs | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | `leave_mgmt.leave_balances` + `leave_mgmt.comp_off_balances` |
| Leave Calendar (Who's Away) | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | aggregation over leave_requests by date range |
| Apply for Leave (employee) | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | |
| Approve/Reject (manager) | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | needs RBAC role check |

## Module 6: Recruitment & Onboarding

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Hiring Pipeline: Job Openings | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | needs `recruitment.requisitions`, `recruitment.applications` |
| Hiring Pipeline: Applicants & Interviews | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | needs `recruitment.candidates`, `recruitment.interview_stages` |
| Offer Management | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `recruitment.offers` |
| Onboarding tasks/checklist | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `recruitment.onboarding_tasks` |
| Asset Allocation | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `hrms.asset_allocations` |
| Employee Vault: Letters & Contracts | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | template storage + render |
| Employee Vault: Document Vault | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `hrms.employee_documents` with verification states |

## Module 7: Payroll

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Payroll Dashboard (total, avg salary, TDS) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | aggregates over payroll tables |
| Salary Structure (CTC components per employee) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `payroll.salary_structures`, `payroll.components` |
| Processing & Payslips (pay cycle runs) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `payroll.payroll_runs`, `payroll.payslips` |
| Production-Linked Incentive (PLI) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `payroll.pli_targets`, computed bonus pool |
| Advances & Loans | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `payroll.advances`, EMI recovery schedule |
| Bank Disbursement (NEFT/RTGS batch files) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `payroll.disbursement_batches` + file generator |

## Module 8: Expense Management

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Expense Center KPIs | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | aggregates |
| Claims & Approvals | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `expense.claims` |
| Travel Advances | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `expense.travel_advances` |
| Reimbursements (batch) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `expense.reimbursement_batches` |

## Module 9: Employee Self Service

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| My Attendance & Leaves | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | reuses attendance + leave canonical; needs self-scoped endpoint |
| My Payslips | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | blocked by payroll |
| My Profile (view + edit own employee record) | DONE | DONE | DONE | DONE | MISSING | P4 | exists at `/v1/hrms/employees/{id}` but no "self" alias |
| Team Attendance (manager view of reports) | SCHEMA | MISSING | MISSING | MISSING | MISSING | P2 | self + direct-reports scope filter |

## Module 10: Performance & Learning

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Employee Performance ratings | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `performance.ratings` |
| Appraisals & 360 Feedback cycles | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `performance.appraisal_cycles`, `performance.reviews` |
| KPI Tracking | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `performance.kpis` |
| Skill Matrix | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `performance.skills`, `performance.employee_skills` |
| Training Programs | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `learning.training_programs`, `learning.enrollments` |
| Certifications | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `learning.certifications` with expiry tracking |

## Module 11: Compliance

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Statutory Compliance (PF/ESI/PT/TDS filings) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `compliance.statutory_filings` |
| Muster Roll (Factory Act registers) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `compliance.muster_rolls` + Form-D generator |
| POSH Case Management (IC-restricted) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `compliance.posh_cases` with row-level access by IC member |
| Inspector View (read-only OTP links) | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `compliance.inspector_sessions` with temp token |
| Compliance Calendar | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | derive from statutory_filings due dates |

## Module 12: Reports & Analytics

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Attendance & Overtime Reports | N/A | N/A | MISSING | MISSING | MISSING | P5 | aggregates over P2 attendance |
| Payroll Reports & Reconciliation | N/A | N/A | MISSING | MISSING | MISSING | P5 | aggregates over P5 payroll |
| Workforce Analytics & Insights | N/A | N/A | MISSING | MISSING | MISSING | P5 | attrition, diversity, tenure analytics |

## Module 13: Employee Exit

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| Resignation & Exit Workflow | PARTIAL | PARTIAL | PARTIAL | PARTIAL | MISSING | P5 | `POST /v1/hrms/employees/{id}/notice` + `/exit` exist; missing approval workflow + status board |
| Full & Final Settlement | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | `hrms.full_final_settlements` calc |
| Experience & Relieving Letters | MISSING | MISSING | MISSING | MISSING | MISSING | P5 | template rendering + signoff |

## Module 14: Settings

| Client page | Schema | Entity | Service | REST | Frontend | Phase | Notes |
|---|---|---|---|---|---|---|---|
| HR Configuration | DONE | DONE | DONE | DONE | MISSING | P4 | `/v1/settings/hr-configuration` |
| Holiday Calendar | DONE | DONE | DONE | DONE | MISSING | P4 | `/v1/settings/holidays` |
| Role & Permissions | SCHEMA | MISSING | MISSING | MISSING | MISSING | P1 | 5 system roles + 25 permissions seeded; entities + endpoints next |
| Notification Templates | SCHEMA | MISSING | MISSING | MISSING | MISSING | P3 | `settings.notification_templates` table seeded for categories Leaves/Payroll/Onboarding |
| Integrations (Google/Slack/Essl/Jira) | SCHEMA | MISSING | MISSING | MISSING | MISSING | P3 | `settings.integrations` with status + JSON config |
| Audit Logs (read) | SCHEMA | MISSING | MISSING | MISSING | MISSING | P3 | `audit.events` partitioned; writer + reader pending |

---

## Summary by status

| Status | Count |
|---|---|
| DONE (schema + entity + service + REST) | 10 pages |
| SCHEMA (canonical SQL only) | 16 pages |
| PARTIAL | 2 pages |
| MISSING | 33 pages |
| N/A (read-only aggregations) | 9 pages |
| Total client pages catalogued | 70 |

Honest parity: 10/70 ~ 14% of client pages have working backend code today. The remaining 60 pages need code (and frontend) before we can claim feature parity.

---

## Phase plan (in priority order)

**P1 - canonical auth + RBAC (~2 sessions)**
- Migrate `com.hrms.auth` services onto `auth.user_credentials`, `auth.otp_codes`, `auth.refresh_tokens`
- Add `rbac.RoleService`, `rbac.PermissionService`, `rbac.UserRoleService` + REST
- Wire JWT issuer with `tenant_id` + `roles` claims; replace `X-Tenant-ID` runtime gate with JWT-only resolution
- Add Spring Security `@PreAuthorize` enforcement (already on controllers; needs `@EnableMethodSecurity` in production security config)

**P2 - canonical attendance + leave (~3 sessions)**
- Entities + services + REST for `attendance.records`, `attendance.event_logs`, `attendance.regularization_requests`
- Entities + services + REST for `leave_mgmt.leave_types`, `leave_mgmt.leave_balances`, `leave_mgmt.leave_requests`, `leave_mgmt.comp_off_balances`
- Self-service variants (`/v1/me/attendance`, `/v1/me/leave`) using JWT employee_id

**P3 - rules/policies + notification/audit (~2 sessions)**
- `attendance.shift_policies` + `employee_shift_assignments` services + REST (Rules & Policies page)
- `settings.notification_templates` + `settings.integrations` services + REST
- Audit writer: Spring `@EventListener` capturing entity CREATE/UPDATE/DELETE -> insert into `audit.events`
- Audit reader endpoint with `audit.read` permission gate

**P4 - HRMS frontend wiring (~3-4 sessions)**
- Match the 10 DONE pages plus all of P1/P2/P3 once they ship
- Use the existing `apps/platform` shell with Cal Sans + emerald palette already in place
- React Query + React Hook Form + Zod for forms

**P5 - long tail (estimated ~15-25 sessions)**
- Recruitment, Payroll, Expense, Performance, Compliance, Reports, Exit
- Each is a 2-5 session module: schema migration -> entities -> services -> REST -> frontend
