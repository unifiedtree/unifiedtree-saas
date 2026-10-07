-- V143.105: payroll settings per company (owner decision 7 Oct 2026: "payroll follows the chosen company",
-- so its settings do too).
--
-- Until now payroll.settings held ONE row per workspace (tenant_id is its primary key): PF, ESI, PT and
-- LWF switches and rates, establishment codes, the pay cycle start day, the processing (pay) day, the
-- sandwich rule and the late-mark LOP threshold. Every company of a workspace shared them.
--
-- payroll.company_settings: the same columns, one row per (workspace, company). The server reads the
-- row of the company a request or payroll run is for; a company without a row (one made after this
-- file) falls back to the workspace row in payroll.settings, which stays as it is and keeps being the
-- template. Saving settings for a company creates its row from the workspace row first.
--
-- Day one: every existing workspace row is COPIED to every company of that workspace, so all companies
-- start with exactly the settings they use today and nothing changes for anyone (nclever has one
-- company: its one row becomes that company's row, with the same values). Nothing is deleted.
--
-- Safety. A new table, read and written with JDBC only (no JPA entity maps payroll.settings or this
-- table); payroll.settings is not altered. The server checks that this table exists before using it,
-- so it starts and works the same before and after this file is applied (before: the workspace row,
-- exactly as today). No new permission, so OwnerPermissionInvariantCheck is unaffected. Deleting a
-- company deletes its row.
--
-- Numbered 143.105 (reserved). Idempotent (IF NOT EXISTS, guarded DO blocks, ON CONFLICT DO NOTHING):
-- running it again copies nothing over a company row that exists. Production has Flyway OFF: apply by
-- hand, as the table owner (row-level security is bypassed by the migration role, V081).

CREATE TABLE IF NOT EXISTS payroll.company_settings (
    tenant_id                 UUID          NOT NULL,
    company_id                UUID          NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    pf_enabled                BOOLEAN       NOT NULL DEFAULT FALSE,
    pf_employee_percent       NUMERIC(6,3)  NOT NULL DEFAULT 12.000,
    pf_employer_percent       NUMERIC(6,3)  NOT NULL DEFAULT 12.000,
    pf_wage_ceiling           NUMERIC(12,2) DEFAULT 15000.00,
    pf_apply_ceiling          BOOLEAN       NOT NULL DEFAULT TRUE,
    pf_establishment_code     VARCHAR(40),
    esi_enabled               BOOLEAN       NOT NULL DEFAULT FALSE,
    esi_employee_percent      NUMERIC(6,3)  NOT NULL DEFAULT 0.750,
    esi_employer_percent      NUMERIC(6,3)  NOT NULL DEFAULT 3.250,
    esi_wage_ceiling          NUMERIC(12,2) DEFAULT 21000.00,
    esi_establishment_code    VARCHAR(40),
    pt_enabled                BOOLEAN       NOT NULL DEFAULT FALSE,
    pt_state_code             VARCHAR(10),
    lwf_enabled               BOOLEAN       NOT NULL DEFAULT FALSE,
    lwf_employee_amount       NUMERIC(8,2)  DEFAULT 0,
    lwf_employer_amount       NUMERIC(8,2)  DEFAULT 0,
    lwf_deduction_months      INTEGER[]     NOT NULL DEFAULT ARRAY[6, 12],
    sandwich_rule_enabled     BOOLEAN       NOT NULL DEFAULT FALSE,
    late_mark_lop_threshold   INT,
    payroll_cycle_start_day   INT           NOT NULL DEFAULT 1,
    payroll_cycle_end_day     INT           NOT NULL DEFAULT 31,
    salary_processing_day     INT           NOT NULL DEFAULT 28,
    effective_from            DATE          NOT NULL DEFAULT CURRENT_DATE,
    created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_payroll_company_settings PRIMARY KEY (tenant_id, company_id),
    CONSTRAINT ck_payroll_company_settings_cycle_start CHECK (payroll_cycle_start_day BETWEEN 1 AND 31),
    CONSTRAINT ck_payroll_company_settings_lwf_months
        CHECK (lwf_deduction_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12])
);

COMMENT ON TABLE payroll.company_settings IS
    'Payroll settings per company (V143.105): same columns as payroll.settings. No row = the workspace row in payroll.settings. JDBC only.';

ALTER TABLE payroll.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.company_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'payroll' AND tablename = 'company_settings'
                      AND policyname = 'tenant_isolation_payroll_company_settings') THEN
        CREATE POLICY tenant_isolation_payroll_company_settings ON payroll.company_settings
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- The same roles that read and write payroll.settings today (V046: hrms_app; the app's role: ut_app).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA payroll TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.company_settings TO ut_app;
    ELSE
        RAISE NOTICE 'V143.105: role ut_app not present — grant skipped';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA payroll TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.company_settings TO hrms_app;
    END IF;
END $$;

-- Day one: each workspace's settings, copied to every company it has.
INSERT INTO payroll.company_settings
    (tenant_id, company_id,
     pf_enabled, pf_employee_percent, pf_employer_percent, pf_wage_ceiling, pf_apply_ceiling, pf_establishment_code,
     esi_enabled, esi_employee_percent, esi_employer_percent, esi_wage_ceiling, esi_establishment_code,
     pt_enabled, pt_state_code,
     lwf_enabled, lwf_employee_amount, lwf_employer_amount, lwf_deduction_months,
     sandwich_rule_enabled, late_mark_lop_threshold,
     payroll_cycle_start_day, payroll_cycle_end_day, salary_processing_day, effective_from)
SELECT s.tenant_id, c.id,
       s.pf_enabled, s.pf_employee_percent, s.pf_employer_percent, s.pf_wage_ceiling, s.pf_apply_ceiling, s.pf_establishment_code,
       s.esi_enabled, s.esi_employee_percent, s.esi_employer_percent, s.esi_wage_ceiling, s.esi_establishment_code,
       s.pt_enabled, s.pt_state_code,
       s.lwf_enabled, s.lwf_employee_amount, s.lwf_employer_amount, s.lwf_deduction_months,
       s.sandwich_rule_enabled, s.late_mark_lop_threshold,
       s.payroll_cycle_start_day, s.payroll_cycle_end_day, s.salary_processing_day, s.effective_from
  FROM payroll.settings s
  JOIN org.companies c ON c.tenant_id = s.tenant_id
ON CONFLICT (tenant_id, company_id) DO NOTHING;

DO $$ DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM payroll.company_settings;
    RAISE NOTICE 'V143.105: payroll.company_settings rows: %', n;
END $$;
