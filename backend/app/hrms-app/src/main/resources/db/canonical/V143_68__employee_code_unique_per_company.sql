-- V143.68: an employee code is unique within its company, not the whole workspace.
--
-- The client confirmed on 2026-10-03 that a customer pays per company, so each
-- company is its own unit and numbers its own people. Until now the constraint was
-- UNIQUE (tenant_id, employee_code) — workspace-wide — while the counter that issues
-- codes is keyed on company_id (WorkforceEmployeeService.generateEmployeeCode reads
-- settings.hr_configuration WHERE company_id = ?). The two disagreed.
--
-- What that cost: a company with no hr_configuration row falls back to the default
-- prefix EMP starting at 1, so the FIRST employee added to any second company asked
-- for EMP-0001 — which the workspace's first company already held — and the insert
-- died on the constraint. Production hit this twice on 2026-10-03 (05:45 and 05:46
-- UTC, revision 00176-fcd, tenant d53147aa). Four workspaces have more than one
-- company (demo-hrms 8, demotech 4, sri 3, srcai 2), and in every one of them adding
-- the first employee to a new company was impossible.
--
-- The fix matches the constraint to the counter rather than the other way round:
-- each company numbers from EMP-0001. Two people in different companies of the same
-- workspace may now share a code, which is the intended meaning of per-company
-- billing — their company is what identifies them.
--
-- Safe to apply: hrms.employees has zero (tenant_id, employee_code) duplicates today
-- (verified against production 2026-10-03), because the old constraint was refusing
-- them. The new key is strictly narrower, so every existing row satisfies it.
-- Checked first: no code reads uq_employee_tenant_code by name, and
-- EmployeeRepository.findByEmployeeCode has no callers.
--
-- Idempotent. Production has Flyway OFF: apply by hand, as a superuser.

ALTER TABLE hrms.employees DROP CONSTRAINT IF EXISTS uq_employee_tenant_code;

DO $$
BEGIN
    ALTER TABLE hrms.employees
      ADD CONSTRAINT uq_employee_company_code UNIQUE (tenant_id, company_id, employee_code);
EXCEPTION
    WHEN duplicate_table THEN NULL;  -- already added by an earlier run
END $$;
