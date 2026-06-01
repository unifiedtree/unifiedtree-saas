-- =============================================================================
-- MODULE: hrms-payroll
-- Tables: employee_salary_structures, payroll_runs, payslips,
--         payslip_components, tax_slabs
-- Purpose: Salary configuration, monthly payroll processing, payslip generation,
--          and Indian tax slab management (TDS / Income Tax).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: employee_salary_structures
-- Defines the CTC breakdown for an employee.  Effective date ranges allow
-- salary revisions without losing history.
-- Only one row per employee should have is_active=true (enforced by the app).
-- basic = ctc_annual * (basic_percent / 100) / 12
-- hra   = ctc_annual * (hra_percent / 100) / 12
-- special_allowance = monthly_gross - basic - hra - other_components
-- -----------------------------------------------------------------------------
CREATE TABLE employee_salary_structures (
    id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID             NOT NULL,
    employee_id   UUID             NOT NULL,  -- → employees.id
    company_id    UUID             NOT NULL,  -- → companies.id
    effective_from DATE            NOT NULL,
    effective_to   DATE,                      -- NULL = currently active
    ctc_annual     NUMERIC(15,2)   NOT NULL,
    basic_percent  DOUBLE PRECISION DEFAULT 40.0,
    hra_percent    DOUBLE PRECISION DEFAULT 20.0,
    is_active      BOOLEAN         NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_salary_structure_employee ON employee_salary_structures (employee_id, is_active);

COMMENT ON COLUMN employee_salary_structures.ctc_annual   IS 'Annual Cost-to-Company in INR (or company currency).';
COMMENT ON COLUMN employee_salary_structures.basic_percent IS 'Percentage of ctc_annual. Default 40%. Basic is PF-eligible.';
COMMENT ON COLUMN employee_salary_structures.is_active    IS 'Only one active structure per employee at a time.';

-- -----------------------------------------------------------------------------
-- TABLE: payroll_runs
-- One run per company per (month, year).  Triggered by HR, processed by Spring Batch.
-- status: DRAFT | IN_PROGRESS | COMPLETED | FAILED | CANCELLED
-- batch_job_execution_id: Spring Batch JobExecution.id for traceability.
-- -----------------------------------------------------------------------------
CREATE TABLE payroll_runs (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    company_id            UUID          NOT NULL,  -- → companies.id
    month                 INT           NOT NULL,  -- 1–12
    year                  INT           NOT NULL,
    status                VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',  -- DRAFT | IN_PROGRESS | COMPLETED | FAILED | CANCELLED
    total_employees       INT           DEFAULT 0,
    processed_count       INT           DEFAULT 0,
    total_gross_pay       NUMERIC(15,2),
    total_net_pay         NUMERIC(15,2),
    total_deductions      NUMERIC(15,2),
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    initiated_by          VARCHAR(255),             -- email of HR who triggered the run
    batch_job_execution_id BIGINT,                  -- Spring Batch job reference
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by            VARCHAR(255),
    updated_by            VARCHAR(255),
    version               BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_payroll_run_company_month_year UNIQUE (tenant_id, company_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_company ON payroll_runs (company_id, year, month);

-- -----------------------------------------------------------------------------
-- TABLE: payslips
-- One payslip per employee per (month, year), linked to a payroll_run.
-- lop_days: Loss-of-Pay days (absent without approved leave).
-- status: GENERATED (internal) | PUBLISHED (visible to employee)
-- -----------------------------------------------------------------------------
CREATE TABLE payslips (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    payroll_run_id   UUID          NOT NULL REFERENCES payroll_runs(id),
    employee_id      UUID          NOT NULL,  -- → employees.id
    company_id       UUID          NOT NULL,  -- → companies.id
    month            INT           NOT NULL,
    year             INT           NOT NULL,
    gross_pay        NUMERIC(15,2) NOT NULL,
    total_deductions NUMERIC(15,2) NOT NULL,
    net_pay          NUMERIC(15,2) NOT NULL,  -- gross_pay - total_deductions
    working_days     INT,                      -- total working days in the month
    present_days     INT,                      -- days employee was present
    lop_days         INT,                      -- Loss-of-Pay days (absent without leave)
    pf_contribution  NUMERIC(10,2),            -- Employee PF (12% of basic, max ₹1800/mo)
    esi_contribution NUMERIC(10,2),            -- Employee ESI (0.75% of gross, if applicable)
    tds_deducted     NUMERIC(10,2),            -- Monthly TDS advance
    status           VARCHAR(30)   NOT NULL DEFAULT 'GENERATED',  -- GENERATED | PUBLISHED
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_payslip_employee_month_year UNIQUE (tenant_id, employee_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips (employee_id, year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_payslips_run      ON payslips (payroll_run_id);

COMMENT ON COLUMN payslips.lop_days        IS 'Loss-of-Pay days deducted proportionally from gross pay.';
COMMENT ON COLUMN payslips.pf_contribution IS 'Employee PF share: 12% of basic salary, capped at ₹1800/month.';
COMMENT ON COLUMN payslips.tds_deducted    IS 'Monthly advance TDS computed from projected annual income and tax_slabs.';

-- -----------------------------------------------------------------------------
-- TABLE: payslip_components
-- Line-item earnings and deductions on a payslip.
-- component_type: BASIC | HRA | SPECIAL_ALLOWANCE | LTA | MEDICAL | PF | ESI |
--                 TDS | PROFESSIONAL_TAX | LOP | BONUS | OTHER_EARNING | OTHER_DEDUCTION
-- is_earning: true = earning row, false = deduction row
-- -----------------------------------------------------------------------------
CREATE TABLE payslip_components (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    payslip_id     UUID          NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
    component_type VARCHAR(50)   NOT NULL,  -- BASIC | HRA | SPECIAL_ALLOWANCE | LTA | MEDICAL | PF | ESI | TDS | PROFESSIONAL_TAX | LOP | BONUS | OTHER_EARNING | OTHER_DEDUCTION
    component_name VARCHAR(100)  NOT NULL,  -- display name on PDF payslip
    amount         NUMERIC(15,2) NOT NULL,
    is_earning     BOOLEAN       NOT NULL DEFAULT true,  -- false = deduction
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_payslip_components_payslip ON payslip_components (payslip_id);

-- -----------------------------------------------------------------------------
-- TABLE: tax_slabs
-- Indian Income Tax slabs per financial year and regime (OLD / NEW).
-- max_income NULL = no upper limit (top slab).
-- The payroll engine finds applicable slabs for an employee's projected annual
-- income and computes TDS based on applicable tax_rate_percent + surcharge_percent.
-- -----------------------------------------------------------------------------
CREATE TABLE tax_slabs (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    company_id        UUID          NOT NULL,  -- → companies.id
    financial_year    VARCHAR(10)   NOT NULL,  -- e.g. '2024-25'
    min_income        NUMERIC(15,2) NOT NULL,
    max_income        NUMERIC(15,2),            -- NULL = no upper limit
    tax_rate_percent  DOUBLE PRECISION NOT NULL,
    surcharge_percent DOUBLE PRECISION DEFAULT 0,
    regime            VARCHAR(10)   NOT NULL DEFAULT 'NEW',  -- OLD | NEW
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0
);

COMMENT ON COLUMN tax_slabs.max_income    IS 'NULL for the top slab (no upper ceiling).';
COMMENT ON COLUMN tax_slabs.regime        IS 'OLD = pre-2023 regime with deductions; NEW = simplified flat slabs.';
