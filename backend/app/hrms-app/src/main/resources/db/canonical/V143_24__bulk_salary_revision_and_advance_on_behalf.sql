-- V143.24: payroll features built on 2026-09-25 (worktree w2e).
--
-- 1. Bulk revise CTC. HR/finance choose people (company, department, grade,
--    designation or an explicit list), revise their CTC by a percentage or a
--    fixed annual amount from an effective date, preview old/new/difference
--    per person, then apply. Applying writes one new salary structure
--    revision per person (same split rule as the salary drawer: each person's
--    own earning lines scale in proportion) and one row in the new
--    payroll.salary_revision_batches table, so every bulk change can be traced
--    back to who applied it, when, why and for how many people. Each new
--    structure points at its batch (employee_salary_structures.revision_batch_id).
--    New permission payroll.structure.bulk-revise (HIGH risk).
--
-- 2. Issue an advance for someone else. HR/finance raise a salary advance on
--    an employee's behalf; it follows the normal approval -> payout ->
--    recovery flow. advance_requests.raised_by_employee_id records who raised
--    it (NULL = the employee asked for it themselves). New permission
--    hrms.advance.request.others.
--
-- OWNER and SUPER_ADMIN receive every new permission (OwnerPermissionInvariantCheck).
-- Idempotent: safe to run more than once. Numbered 143.24 (assigned range).

-- ── 1. Bulk salary revision batches ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll.salary_revision_batches (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID          NOT NULL,
    -- PERCENT: CTC x (1 + value/100). AMOUNT: CTC + value (rupees a year).
    mode                   VARCHAR(10)   NOT NULL,
    value                  NUMERIC(14,2) NOT NULL,
    effective_from         DATE          NOT NULL,
    reason                 TEXT          NOT NULL,
    -- The selection as it was sent (company / department / grade / designation / people).
    filters                JSONB         NOT NULL DEFAULT '{}'::jsonb,
    employee_count         INT           NOT NULL,
    total_old_ctc          NUMERIC(16,2) NOT NULL,
    total_new_ctc          NUMERIC(16,2) NOT NULL,
    applied_by_user_id     UUID,
    applied_by_employee_id UUID,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_salary_revision_mode CHECK (mode IN ('PERCENT', 'AMOUNT')),
    CONSTRAINT ck_salary_revision_value CHECK (value > 0),
    CONSTRAINT ck_salary_revision_count CHECK (employee_count > 0)
);
CREATE INDEX IF NOT EXISTS idx_salary_revision_batches_tenant
    ON payroll.salary_revision_batches (tenant_id, created_at DESC);

ALTER TABLE payroll.salary_revision_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.salary_revision_batches FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'payroll'
           AND tablename  = 'salary_revision_batches'
           AND policyname = 'salary_revision_batches_tenant'
    ) THEN
        CREATE POLICY salary_revision_batches_tenant ON payroll.salary_revision_batches
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

ALTER TABLE payroll.employee_salary_structures
    ADD COLUMN IF NOT EXISTS revision_batch_id UUID;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_structure_revision_batch'
    ) THEN
        ALTER TABLE payroll.employee_salary_structures
            ADD CONSTRAINT fk_structure_revision_batch
            FOREIGN KEY (revision_batch_id) REFERENCES payroll.salary_revision_batches (id)
            ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_structures_revision_batch
    ON payroll.employee_salary_structures (revision_batch_id)
    WHERE revision_batch_id IS NOT NULL;

-- ── 2. Advances raised on someone's behalf ──────────────────────────────────
ALTER TABLE advance_mgmt.advance_requests
    ADD COLUMN IF NOT EXISTS raised_by_employee_id UUID;

-- ── 3. Runtime grants (production connects as ut_app) ───────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.salary_revision_batches TO ut_app;
    END IF;
END $$;

-- ── 4. Permissions ──────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('payroll.structure.bulk-revise', 'Bulk revise salaries (high risk)', 'payroll',
     'Raise the CTC of many employees at once, by a percentage or a fixed yearly amount, from a chosen date. '
     || 'Each person gets a new salary structure and payroll uses it from the next run. '
     || 'High risk: one action changes pay for everyone selected, and undoing it means editing each person''s structure by hand.'),
    ('hrms.advance.request.others', 'Raise advances for other employees', 'advance',
     'Raise a salary advance request on behalf of any employee (amount, reason, recovery months). '
     || 'It still needs the usual approval and payout, is recovered from that employee''s salary, and the employee is notified.')
ON CONFLICT (code) DO NOTHING;

-- Bulk revise: the roles that already manage salary structures.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'payroll.structure.bulk-revise'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'FINANCE_LEAD')
ON CONFLICT DO NOTHING;

-- Advance on behalf: HR and finance (plus OWNER / SUPER_ADMIN).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.advance.request.others'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD')
ON CONFLICT DO NOTHING;
