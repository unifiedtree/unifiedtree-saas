-- ============================================================================
-- V046 - Payroll foundation schema (Prompt 12). NO calculation logic.
-- ----------------------------------------------------------------------------
-- Salary component catalog, tenant payroll settings, PT slabs (reference),
-- per-employee salary structures, payroll run lifecycle scaffold, payslip line
-- + LOP scaffold tables. All tenant tables are RLS-isolated via
-- current_tenant_id() (V001). DB role is hrms_app (app_user is guarded).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS payroll;

-- ─── Salary Components (the catalog) ─────────────────────────────────────────
CREATE TABLE payroll.salary_components (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    code              VARCHAR(40) NOT NULL,
    name              VARCHAR(100) NOT NULL,
    category          VARCHAR(24) NOT NULL
                      CHECK (category IN ('EARNING','DEDUCTION','EMPLOYER_CONTRIBUTION','REIMBURSEMENT')),
    is_statutory      BOOLEAN NOT NULL DEFAULT FALSE,
    is_taxable        BOOLEAN NOT NULL DEFAULT TRUE,
    computation_type  VARCHAR(20) NOT NULL
                      CHECK (computation_type IN ('FIXED','PERCENT_OF_BASIC','PERCENT_OF_GROSS','FORMULA','STATUTORY')),
    percent_value     NUMERIC(6,3),
    formula_expr      TEXT,
    display_order     INT NOT NULL DEFAULT 100,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    is_system         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_component_code UNIQUE (tenant_id, code)
);
CREATE INDEX idx_components_tenant_active ON payroll.salary_components(tenant_id, is_active);

-- ─── Tenant Payroll Settings ─────────────────────────────────────────────────
CREATE TABLE payroll.settings (
    tenant_id                 UUID PRIMARY KEY,
    pf_enabled                BOOLEAN NOT NULL DEFAULT FALSE,
    pf_employee_percent       NUMERIC(6,3) NOT NULL DEFAULT 12.000,
    pf_employer_percent       NUMERIC(6,3) NOT NULL DEFAULT 12.000,
    pf_wage_ceiling           NUMERIC(12,2) DEFAULT 15000.00,
    pf_apply_ceiling          BOOLEAN NOT NULL DEFAULT TRUE,
    pf_establishment_code     VARCHAR(40),
    esi_enabled               BOOLEAN NOT NULL DEFAULT FALSE,
    esi_employee_percent      NUMERIC(6,3) NOT NULL DEFAULT 0.750,
    esi_employer_percent      NUMERIC(6,3) NOT NULL DEFAULT 3.250,
    esi_wage_ceiling          NUMERIC(12,2) DEFAULT 21000.00,
    esi_establishment_code    VARCHAR(40),
    pt_enabled                BOOLEAN NOT NULL DEFAULT FALSE,
    pt_state_code             VARCHAR(10),
    lwf_enabled               BOOLEAN NOT NULL DEFAULT FALSE,
    lwf_employee_amount       NUMERIC(8,2) DEFAULT 0,
    lwf_employer_amount       NUMERIC(8,2) DEFAULT 0,
    sandwich_rule_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    late_mark_lop_threshold   INT,
    payroll_cycle_start_day   INT NOT NULL DEFAULT 1 CHECK (payroll_cycle_start_day BETWEEN 1 AND 31),
    payroll_cycle_end_day     INT NOT NULL DEFAULT 31,
    salary_processing_day     INT NOT NULL DEFAULT 28,
    effective_from            DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Professional Tax Slabs (state-wise reference data, NOT tenant-scoped) ────
CREATE TABLE payroll.pt_slabs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_code      VARCHAR(10) NOT NULL,
    state_name      VARCHAR(60) NOT NULL,
    min_salary      NUMERIC(12,2) NOT NULL,
    max_salary      NUMERIC(12,2),
    monthly_tax     NUMERIC(8,2) NOT NULL,
    effective_from  DATE NOT NULL,
    effective_to    DATE,
    CONSTRAINT uq_pt_slab UNIQUE (state_code, min_salary, effective_from)
);
CREATE INDEX idx_pt_slabs_state ON payroll.pt_slabs(state_code, effective_from);

-- ─── Employee Salary Structure ───────────────────────────────────────────────
-- is_current uses TRUE / NULL (never FALSE) so a DEFERRABLE UNIQUE on
-- (employee_id, is_current) enforces "exactly one current" while permitting
-- unlimited history (NULLs are distinct in a UNIQUE constraint).
CREATE TABLE payroll.employee_salary_structures (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    employee_id       UUID NOT NULL,
    ctc_annual        NUMERIC(14,2) NOT NULL,
    ctc_monthly       NUMERIC(14,2) NOT NULL,
    pf_applicable     BOOLEAN NOT NULL DEFAULT TRUE,
    pf_status         VARCHAR(30) NOT NULL DEFAULT 'ENROLLED'
                      CHECK (pf_status IN ('ENROLLED','EXEMPTED_FORM_11','OPTED_OUT_AT_JOINING','NOT_APPLICABLE')),
    esi_applicable    BOOLEAN NOT NULL DEFAULT FALSE,
    pt_state          VARCHAR(10),
    tax_regime        VARCHAR(10) NOT NULL DEFAULT 'NEW' CHECK (tax_regime IN ('OLD','NEW')),
    revision_note     TEXT,
    effective_from    DATE NOT NULL,
    effective_to      DATE,
    is_current        BOOLEAN,   -- TRUE for current, NULL for historical
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_emp_current_structure UNIQUE (employee_id, is_current) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX idx_structures_employee ON payroll.employee_salary_structures(employee_id, is_current);
CREATE INDEX idx_structures_tenant_eff ON payroll.employee_salary_structures(tenant_id, effective_from DESC);

-- ─── Per-Employee Component Amounts ──────────────────────────────────────────
CREATE TABLE payroll.employee_structure_components (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    structure_id      UUID NOT NULL REFERENCES payroll.employee_salary_structures(id) ON DELETE CASCADE,
    component_id      UUID NOT NULL REFERENCES payroll.salary_components(id),
    monthly_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    display_order     INT,
    CONSTRAINT uq_structure_component UNIQUE (structure_id, component_id)
);

-- ─── Payroll Runs (lifecycle scaffold, no execution yet) ─────────────────────
CREATE TABLE payroll.runs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    company_id        UUID NOT NULL,
    period_month      INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year       INT NOT NULL CHECK (period_year BETWEEN 2020 AND 2099),
    period_start      DATE NOT NULL,
    period_end        DATE NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','PROCESSING','LOCKED','PAID','CANCELLED')),
    employee_count    INT NOT NULL DEFAULT 0,
    total_gross       NUMERIC(14,2) DEFAULT 0,
    total_deductions  NUMERIC(14,2) DEFAULT 0,
    total_net         NUMERIC(14,2) DEFAULT 0,
    processed_at      TIMESTAMPTZ, processed_by UUID,
    locked_at         TIMESTAMPTZ, locked_by UUID,
    paid_at           TIMESTAMPTZ,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(), created_by UUID,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_payroll_run UNIQUE (tenant_id, company_id, period_year, period_month)
);
CREATE INDEX idx_runs_tenant_period ON payroll.runs(tenant_id, period_year DESC, period_month DESC);

-- ─── Payslip Lines ───────────────────────────────────────────────────────────
CREATE TABLE payroll.payslip_lines (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    run_id            UUID NOT NULL REFERENCES payroll.runs(id) ON DELETE CASCADE,
    employee_id       UUID NOT NULL,
    component_id      UUID NOT NULL REFERENCES payroll.salary_components(id),
    component_code    VARCHAR(40) NOT NULL,
    component_name    VARCHAR(100) NOT NULL,
    category          VARCHAR(24) NOT NULL,
    amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
    display_order     INT,
    CONSTRAINT uq_payslip_line UNIQUE (run_id, employee_id, component_id)
);
CREATE INDEX idx_payslip_run_employee ON payroll.payslip_lines(run_id, employee_id);

-- ─── LOP Days per Run ────────────────────────────────────────────────────────
CREATE TABLE payroll.run_lop_days (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    run_id            UUID NOT NULL REFERENCES payroll.runs(id) ON DELETE CASCADE,
    employee_id       UUID NOT NULL,
    paid_days         NUMERIC(5,2) NOT NULL,
    lop_days          NUMERIC(5,2) NOT NULL DEFAULT 0,
    total_calendar    INT NOT NULL,
    computation_log   JSONB,
    CONSTRAINT uq_run_lop UNIQUE (run_id, employee_id)
);

-- ─── Tax regime on employees (denormalized) ──────────────────────────────────
ALTER TABLE hrms.employees
    ADD COLUMN IF NOT EXISTS tax_regime VARCHAR(10) NOT NULL DEFAULT 'NEW'
        CHECK (tax_regime IN ('OLD','NEW'));

-- ─── RLS on tenant-scoped payroll tables ─────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'salary_components','settings','employee_salary_structures','runs','payslip_lines','run_lop_days'
    ]) LOOP
        EXECUTE format('ALTER TABLE payroll.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE payroll.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON payroll.%I', t, t);
        EXECUTE format($p$
            CREATE POLICY %I_tenant ON payroll.%I
              USING (tenant_id = current_tenant_id())
              WITH CHECK (tenant_id = current_tenant_id())
        $p$, t, t);
    END LOOP;
END $$;

-- employee_structure_components isolates via its parent structure's tenant
ALTER TABLE payroll.employee_structure_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.employee_structure_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS esc_tenant ON payroll.employee_structure_components;
CREATE POLICY esc_tenant ON payroll.employee_structure_components
    USING (EXISTS (SELECT 1 FROM payroll.employee_salary_structures s
                    WHERE s.id = structure_id AND s.tenant_id = current_tenant_id()));

-- ─── Grants (app_user guarded — does not exist here; hrms_app is real) ───────
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'salary_components','settings','pt_slabs','employee_salary_structures',
        'employee_structure_components','runs','payslip_lines','run_lop_days'
    ]) LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.%I TO app_user', t);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hrms_app') THEN
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.%I TO hrms_app', t);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hrms_app') THEN
        GRANT USAGE ON SCHEMA payroll TO hrms_app;
    END IF;
END $$;

-- ─── Default payroll settings for existing tenants ───────────────────────────
INSERT INTO payroll.settings (tenant_id)
SELECT id FROM platform.tenants
ON CONFLICT (tenant_id) DO NOTHING;

DO $$ DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM payroll.settings;
    RAISE NOTICE 'payroll.settings seeded for tenants: %', c;
END $$;
