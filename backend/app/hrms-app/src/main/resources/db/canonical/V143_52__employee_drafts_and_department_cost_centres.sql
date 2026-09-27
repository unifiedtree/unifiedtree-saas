-- V143.52: Add employee drafts, and a cost centre on departments (HRMS redesign, P-WF-PEOPLE).
--
-- 1. hrms.employee_drafts — "Save draft" on Add employee (BW-92). Each row is
--    one person's unfinished Add-employee form, saved by the HR user who typed
--    it (created_by_user_id) and shown only to that user. The server strips
--    PAN, Aadhaar, passport, UAN, ESI and every bank field out of the payload
--    before saving, so none of them is ever stored here.
-- 2. hrms.department_cost_centres — the cost centre of a department (BW-95).
--    hrms.departments is mapped by JPA (Department.java), so the value lives in
--    this side table instead of a new column there.
--
-- Both tables are read and written with JdbcTemplate only (no JPA entity maps
-- them). Until this file is applied the API answers FEATURE_NOT_READY for
-- drafts and leaves the cost centre empty; nothing else changes.
-- No new permissions: drafts use hrms.employee.write, cost centres the
-- department permissions.
--
-- Idempotent. Production has Flyway off: apply by hand, as a superuser
-- (row-level security is forced on both tables).

-- ── 1. employee drafts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.employee_drafts (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL,
    company_id          UUID         NOT NULL,
    created_by_user_id  UUID         NOT NULL,
    payload             JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_employee_drafts_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_employee_drafts_owner
    ON hrms.employee_drafts (tenant_id, created_by_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_drafts_company
    ON hrms.employee_drafts (tenant_id, company_id);

COMMENT ON TABLE hrms.employee_drafts IS
    'Unfinished Add-employee forms, one per save, visible only to the user who saved them. PAN, Aadhaar, passport, UAN, ESI and bank details are stripped before saving (V143.52).';

ALTER TABLE hrms.employee_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_drafts FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'employee_drafts'
                      AND policyname = 'tenant_isolation_employee_drafts') THEN
        CREATE POLICY tenant_isolation_employee_drafts ON hrms.employee_drafts
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. department cost centres ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.department_cost_centres (
    tenant_id      UUID         NOT NULL,
    department_id  UUID         NOT NULL REFERENCES hrms.departments(id) ON DELETE CASCADE,
    cost_centre    VARCHAR(50)  NOT NULL,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_department_cost_centres PRIMARY KEY (tenant_id, department_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_department_cost_centres_department
    ON hrms.department_cost_centres (department_id);

COMMENT ON TABLE hrms.department_cost_centres IS
    'The cost centre of a department, kept beside the JPA-mapped hrms.departments (V143.52).';

ALTER TABLE hrms.department_cost_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.department_cost_centres FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'department_cost_centres'
                      AND policyname = 'tenant_isolation_department_cost_centres') THEN
        CREATE POLICY tenant_isolation_department_cost_centres ON hrms.department_cost_centres
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. grants for the runtime role ───────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.employee_drafts TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.department_cost_centres TO ut_app;
    ELSE
        RAISE NOTICE 'V143.52: role ut_app not present — grants skipped';
    END IF;
END $$;
