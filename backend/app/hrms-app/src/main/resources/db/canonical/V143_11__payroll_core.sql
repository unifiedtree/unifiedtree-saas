-- V143.11: payroll core (25 Sep 2026). Decided with the client:
--   * payroll uses each company's own work week (as leave and attendance do);
--   * approved PLI awards are paid THROUGH payroll.
--
-- What this adds:
-- 1. Salary components
--    - amount:          a fixed monthly amount for FIXED components. percent_value
--                       is NUMERIC(6,3) and can't hold money. Earnings with an
--                       amount are paid to everyone whose salary structure has no
--                       line for the component (pro-rated like other earnings);
--                       deductions with an amount are taken in full.
--    - show_on_payslip: false folds the line into "Other earnings" / "Other
--                       deductions" on payslips and the PDF (totals don't change).
--    - is_active already exists; the API now lets admins switch it (inactive
--      components are skipped from the next run).
-- 2. Payroll settings: lwf_deduction_months, the months (1-12) whose runs deduct
--    the Labour Welfare Fund. June and December by default, as the design said.
--    payroll_cycle_end_day is now always the day before the start day.
-- 3. Payroll runs: pay_date (the planned pay date, from the processing day) and
--    working_days (days in the pay period that are not the company's weekly off
--    or a holiday).
-- 4. PLI awards: approved_at, payroll_run_id (the run that pays it) and paid_at.
--    A run includes every approved, unpaid award approved by the end of its
--    period; locking the run marks those awards paid, reopening reverts them,
--    and the separate "Pay" action refuses an award a run already includes.
-- 5. Seeds the three new built-in components (Performance incentive, LWF
--    employee and employer) for every existing workspace. New workspaces get
--    them from DefaultComponentSeeder, and a run seeds them on demand.
--
-- No new permissions. Idempotent. Numbered 143.11 so it cannot collide with a
-- teammate's V144.

-- ── 1. Salary components ─────────────────────────────────────────────────────
ALTER TABLE payroll.salary_components ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);
ALTER TABLE payroll.salary_components ADD COLUMN IF NOT EXISTS show_on_payslip BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_salary_components_amount') THEN
        ALTER TABLE payroll.salary_components
            ADD CONSTRAINT ck_salary_components_amount CHECK (amount IS NULL OR amount >= 0);
    END IF;
END $$;

-- ── 2. Payroll settings ──────────────────────────────────────────────────────
ALTER TABLE payroll.settings ADD COLUMN IF NOT EXISTS lwf_deduction_months INTEGER[] NOT NULL DEFAULT ARRAY[6, 12];

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_payroll_settings_lwf_months') THEN
        ALTER TABLE payroll.settings
            ADD CONSTRAINT ck_payroll_settings_lwf_months
            CHECK (lwf_deduction_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]);
    END IF;
END $$;

-- The cycle is defined by its start day; the end day is the day before it.
UPDATE payroll.settings
   SET payroll_cycle_end_day = CASE WHEN payroll_cycle_start_day = 1 THEN 31 ELSE payroll_cycle_start_day - 1 END
 WHERE payroll_cycle_end_day IS DISTINCT FROM
       (CASE WHEN payroll_cycle_start_day = 1 THEN 31 ELSE payroll_cycle_start_day - 1 END);

-- ── 3. Payroll runs ──────────────────────────────────────────────────────────
ALTER TABLE payroll.runs ADD COLUMN IF NOT EXISTS pay_date DATE;
ALTER TABLE payroll.runs ADD COLUMN IF NOT EXISTS working_days INTEGER;

-- Existing runs: the planned pay date is the processing day in the month the
-- period ends (clamped to that month's last day). Working days are filled the
-- next time a run is processed.
UPDATE payroll.runs r
   SET pay_date = make_date(
           EXTRACT(YEAR FROM r.period_end)::int,
           EXTRACT(MONTH FROM r.period_end)::int,
           LEAST(s.salary_processing_day,
                 EXTRACT(DAY FROM (date_trunc('month', r.period_end) + INTERVAL '1 month - 1 day'))::int))
  FROM payroll.settings s
 WHERE s.tenant_id = r.tenant_id
   AND r.pay_date IS NULL;

-- ── 4. PLI awards paid through payroll ───────────────────────────────────────
ALTER TABLE pli_mgmt.pli_awards ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE pli_mgmt.pli_awards ADD COLUMN IF NOT EXISTS payroll_run_id UUID;
ALTER TABLE pli_mgmt.pli_awards ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pli_awards_payroll_run') THEN
        ALTER TABLE pli_mgmt.pli_awards
            ADD CONSTRAINT fk_pli_awards_payroll_run
            FOREIGN KEY (payroll_run_id) REFERENCES payroll.runs(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pli_awards_payroll_run ON pli_mgmt.pli_awards (tenant_id, payroll_run_id);

-- Awards approved before this change: their approval time is their last update.
UPDATE pli_mgmt.pli_awards
   SET approved_at = updated_at
 WHERE approved_at IS NULL
   AND status IN ('APPROVED', 'PAID');

-- ── 5. Built-in components for existing workspaces ───────────────────────────
INSERT INTO payroll.salary_components
    (tenant_id, code, name, category, is_statutory, is_taxable, computation_type,
     percent_value, display_order, is_system, is_active)
SELECT t.tenant_id, c.code, c.name, c.category, c.is_statutory, c.is_taxable, c.computation_type,
       NULL, c.display_order, TRUE, TRUE
  FROM (SELECT DISTINCT tenant_id FROM payroll.salary_components) t
 CROSS JOIN (VALUES
       ('PLI_INCENTIVE', 'Performance incentive',          'EARNING',               FALSE, TRUE,  'FORMULA',   45),
       ('LWF_EMPLOYEE',  'Labour Welfare Fund (Employee)', 'DEDUCTION',             TRUE,  FALSE, 'STATUTORY', 95),
       ('LWF_EMPLOYER',  'Labour Welfare Fund (Employer)', 'EMPLOYER_CONTRIBUTION', TRUE,  FALSE, 'STATUTORY', 96)
   ) AS c(code, name, category, is_statutory, is_taxable, computation_type, display_order)
ON CONFLICT (tenant_id, code) DO NOTHING;
