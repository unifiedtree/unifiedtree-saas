# UnifiedTree SaaS Backend - Database Schema Reference

PostgreSQL (≥15). All tables are multi-tenant via `tenant_id UUID NOT NULL`.
Primary keys are `UUID` (`gen_random_uuid()`). Every table inherits the audit
columns below from `BaseEntity`:

```
created_at  TIMESTAMPTZ   auto-set on INSERT
updated_at  TIMESTAMPTZ   auto-set on UPDATE
created_by  VARCHAR(255)  Spring Data auditor
updated_by  VARCHAR(255)  Spring Data auditor
version     BIGINT        optimistic-lock counter
```

---

## Module → File Map

| # | Module | SQL File | Tables |
|---|--------|----------|--------|
| 1 | hrms-core | [01_core.sql](01_core.sql) | audit_log |
| 2 | hrms-auth | [02_auth.sql](02_auth.sql) | user_credentials, user_roles, refresh_tokens |
| 3 | hrms-tenant | [03_tenant.sql](03_tenant.sql) | companies, departments, branches |
| 4 | hrms-employee | [04_employee.sql](04_employee.sql) | employees, emergency_contacts, employee_documents |
| 5 | hrms-attendance | [05_attendance.sql](05_attendance.sql) | attendance_records, shift_policies, geo_fence_audits |
| 6 | hrms-leave | [06_leave.sql](06_leave.sql) | leave_types, leave_balances, leave_requests, holiday_calendars |
| 7 | hrms-payroll | [07_payroll.sql](07_payroll.sql) | employee_salary_structures, payroll_runs, payslips, payslip_components, tax_slabs |
| 8 | hrms-recruitment | [08_recruitment.sql](08_recruitment.sql) | job_postings, candidates, job_applications, interviews, job_offers |
| 9 | hrms-performance | [09_performance.sql](09_performance.sql) | review_cycles, goals, performance_reviews |
| 10 | hrms-learning | [10_learning.sql](10_learning.sql) | courses, enrollments, course_certificates |
| 11 | hrms-expense | [11_expense.sql](11_expense.sql) | expense_policies, expense_claims, expense_items |
| 12 | hrms-notification | [12_notification.sql](12_notification.sql) | notifications |
| — | Demo data | [13_seed_demo.sql](13_seed_demo.sql) | idempotent seed for local dev |
| — | All-in-one | [combined_schema.sql](combined_schema.sql) | Full DDL in dependency order |

---

## Cross-Module Foreign Key Map

These are *logical* FKs. Because modules are independent JARs, they are **not**
enforced as database constraints across modules — referential integrity is
maintained at the application layer.

```
companies          ←─ departments.company_id
companies          ←─ branches.company_id
companies          ←─ employees.company_id
companies          ←─ shift_policies.company_id
companies          ←─ leave_types.company_id
companies          ←─ payroll_runs.company_id
companies          ←─ employee_salary_structures.company_id
companies          ←─ job_postings.company_id
companies          ←─ candidates.company_id
companies          ←─ review_cycles.company_id
companies          ←─ courses.company_id
companies          ←─ expense_policies.company_id
companies          ←─ expense_claims.company_id
companies          ←─ holiday_calendars.company_id

departments        ←─ employees.department_id
departments        ←─ attendance_records.department_id
departments        ←─ job_postings.department_id

branches           ←─ employees.branch_id
branches           ←─ attendance_records.branch_id
branches           ←─ geo_fence_audits.branch_id

employees          ←─ employees.manager_id              (self-referencing hierarchy)
employees          ←─ user_credentials.employee_id
employees          ←─ emergency_contacts.employee_id
employees          ←─ employee_documents.employee_id
employees          ←─ attendance_records.employee_id
employees          ←─ leave_balances.employee_id
employees          ←─ leave_requests.employee_id
employees          ←─ payslips.employee_id
employees          ←─ employee_salary_structures.employee_id
employees          ←─ performance_reviews.employee_id
employees          ←─ performance_reviews.reviewer_id
employees          ←─ goals.employee_id
employees          ←─ enrollments.employee_id
employees          ←─ course_certificates.employee_id
employees          ←─ expense_claims.employee_id
employees          ←─ job_postings.hiring_manager_id
employees          ←─ candidates.referred_by_employee_id
employees          ←─ job_applications.hired_as_employee_id
employees          ←─ courses.created_by_employee_id
employees          ←─ notifications.recipient_id

leave_types        ←─ leave_balances.leave_type_id      (DB FK enforced)
leave_types        ←─ leave_requests.leave_type_id      (DB FK enforced)
payroll_runs       ←─ payslips.payroll_run_id            (DB FK enforced)
payslips           ←─ payslip_components.payslip_id     (DB FK enforced)
job_postings       ←─ job_applications.job_posting_id   (DB FK enforced)
candidates         ←─ job_applications.candidate_id     (DB FK enforced)
job_applications   ←─ interviews.application_id         (DB FK enforced)
job_applications   ←─ job_offers.application_id         (DB FK enforced)
review_cycles      ←─ goals.review_cycle_id             (DB FK enforced)
review_cycles      ←─ performance_reviews.review_cycle_id (DB FK enforced)
courses            ←─ enrollments.course_id             (DB FK enforced)
enrollments        ←─ course_certificates.enrollment_id (DB FK enforced)
expense_claims     ←─ expense_items.claim_id            (DB FK enforced)
```

---

## Enum Reference

### hrms-auth
| Field | Enum Values |
|-------|-------------|
| user_roles.role | `SUPER_ADMIN`, `COMPANY_ADMIN`, `HR_MANAGER`, `DEPT_MANAGER`, `EMPLOYEE` |

### hrms-tenant
| Field | Enum Values |
|-------|-------------|
| companies.subscription_tier | `STARTER`, `GROWTH`, `ENTERPRISE` |

### hrms-employee
| Field | Enum Values |
|-------|-------------|
| employees.gender | `MALE`, `FEMALE`, `OTHER`, `PREFER_NOT_TO_SAY` |
| employees.employment_type | `FULL_TIME`, `PART_TIME`, `CONTRACT`, `INTERN`, `CONSULTANT` |
| employees.employment_status | `ACTIVE`, `ON_LEAVE`, `NOTICE_PERIOD`, `TERMINATED`, `RESIGNED` |
| employee_documents.document_type | `AADHAAR`, `PAN`, `PASSPORT`, `DRIVING_LICENSE`, `DEGREE`, `EXPERIENCE_LETTER`, `OFFER_LETTER`, `OTHER` |

### hrms-attendance
| Field | Enum Values |
|-------|-------------|
| attendance_records.attendance_type | `PRESENT`, `ABSENT`, `HALF_DAY`, `WFH`, `ON_DUTY`, `HOLIDAY`, `WEEKLY_OFF` |
| attendance_records.check_in_method | `FACE`, `GEO`, `MANUAL`, `BIOMETRIC`, `QR` |
| shift_policies.shift_type | `FIXED`, `FLEXIBLE`, `ROTATIONAL`, `NIGHT` |
| geo_fence_audits.action_taken | `CHECKIN_ALLOWED`, `WFH_PROMPTED`, `DENIED` |

### hrms-leave
| Field | Enum Values |
|-------|-------------|
| leave_types.category | `EARNED`, `SICK`, `CASUAL`, `MATERNITY`, `PATERNITY`, `BEREAVEMENT`, `SABBATICAL`, `OTHER` |
| leave_requests.duration | `FULL_DAY`, `FIRST_HALF`, `SECOND_HALF` |
| leave_requests.status | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `WITHDRAWN` |

### hrms-payroll
| Field | Enum Values |
|-------|-------------|
| payroll_runs.status | `DRAFT`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELLED` |
| payslips.status | `GENERATED`, `PUBLISHED` |
| payslip_components.component_type | `BASIC`, `HRA`, `SPECIAL_ALLOWANCE`, `LTA`, `MEDICAL`, `PF`, `ESI`, `TDS`, `PROFESSIONAL_TAX`, `LOP`, `BONUS`, `OTHER_EARNING`, `OTHER_DEDUCTION` |
| tax_slabs.regime | `OLD`, `NEW` |

### hrms-recruitment
| Field | Enum Values |
|-------|-------------|
| job_postings.employment_mode | `FULL_TIME`, `PART_TIME`, `CONTRACT`, `INTERNSHIP`, `FREELANCE` |
| job_postings.status | `DRAFT`, `OPEN`, `ON_HOLD`, `CLOSED`, `CANCELLED` |
| job_applications.status | `APPLIED`, `SCREENING`, `SHORTLISTED`, `INTERVIEW`, `OFFER`, `HIRED`, `REJECTED`, `WITHDRAWN` |
| interviews.interview_type | `PHONE_SCREENING`, `TECHNICAL`, `MANAGERIAL`, `HR_ROUND`, `CASE_STUDY`, `PANEL` |
| interviews.status | `SCHEDULED`, `COMPLETED`, `CANCELLED`, `RESCHEDULED`, `NO_SHOW` |
| job_offers.status | `PENDING`, `APPROVED`, `REJECTED`, `ACCEPTED`, `EXPIRED` |

### hrms-performance
| Field | Enum Values |
|-------|-------------|
| goals.status | `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `OVERDUE` |
| performance_reviews.feedback_type | `SELF`, `MANAGER`, `PEER`, `UPWARD`, `HR` |
| performance_reviews.status | `DRAFT`, `SUBMITTED`, `ACKNOWLEDGED` |

### hrms-learning
| Field | Enum Values |
|-------|-------------|
| courses.status | `DRAFT`, `PUBLISHED`, `ARCHIVED` |
| enrollments.status | `ENROLLED`, `IN_PROGRESS`, `COMPLETED`, `DROPPED` |

### hrms-expense
| Field | Enum Values |
|-------|-------------|
| expense_claims.status / expense_items.category | `TRAVEL`, `FOOD`, `ACCOMMODATION`, `COMMUNICATION`, `OFFICE_SUPPLIES`, `MEDICAL`, `TRAINING`, `ENTERTAINMENT`, `OTHER` |
| expense_claims.status | `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`, `REIMBURSED` |

### hrms-notification
| Field | Enum Values |
|-------|-------------|
| notifications.type | `LEAVE_REQUEST`, `LEAVE_APPROVED`, `LEAVE_REJECTED`, `PAYSLIP_AVAILABLE`, `ATTENDANCE_ALERT`, `EXPENSE_SUBMITTED`, `EXPENSE_APPROVED`, `INTERVIEW_SCHEDULED`, `OFFER_EXTENDED`, `GOAL_DUE`, `COURSE_ASSIGNED`, `GENERAL` |
| notifications.channel | `EMAIL`, `SMS`, `IN_APP`, `PUSH` |

---

## Quick-Start (local dev)

```bash
# 1. Start Postgres via Docker Compose
docker-compose up -d postgres

# 2. Apply all migrations in order (Flyway does this automatically on app start)
#    OR manually:
psql -U hrms -d hrmsdb -f schema/combined_schema.sql

# 3. Seed demo data (already included in combined_schema.sql)
#    Login: admin@demo-corp.com / Admin@123
#    tenant_id: aaaaaaaa-0000-0000-0000-000000000001
```
