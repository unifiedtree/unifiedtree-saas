-- V143.23: leave accrual / carry forward / encashment, shift code + core hours
-- + weekly offs per shift, and policy delete / reminders / email on publish /
-- optional acknowledgement. Built together because Master's Rules & Policies
-- pages switch all of them on at once (docs/Designs/STATIC-UI-TO-BUILD.md §6).
--
-- Numbered 143.23 so it cannot collide with a teammate's migration.
-- Idempotent: every statement can run twice. Production has Flyway off; apply
-- by hand after V143_22 (or the latest applied) and before deploying the
-- backend that reads these columns (Hibernate validates them on start).

-- ── 1. Leave types: how the quota is credited, and encashment limits ────────
-- accrual_frequency already exists (V008, default 'YEARLY') but nothing read
-- it. YEARLY = the whole quota at the start of the year (what every balance
-- did until now), MONTHLY = quota/12 on the 1st of each month, QUARTERLY =
-- quota/4 on the 1st of Jan, Apr, Jul and Oct.
UPDATE leave_mgmt.leave_types
   SET accrual_frequency = 'YEARLY'
 WHERE accrual_frequency IS NULL
    OR accrual_frequency NOT IN ('YEARLY', 'MONTHLY', 'QUARTERLY');
ALTER TABLE leave_mgmt.leave_types ALTER COLUMN accrual_frequency SET DEFAULT 'YEARLY';

-- The most days of this type one person may encash in a leave year. NULL = no
-- yearly limit (the available balance is still the limit).
ALTER TABLE leave_mgmt.leave_types ADD COLUMN IF NOT EXISTS max_encash_days INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_leave_types_accrual_frequency') THEN
        ALTER TABLE leave_mgmt.leave_types ADD CONSTRAINT ck_leave_types_accrual_frequency
            CHECK (accrual_frequency IS NULL OR accrual_frequency IN ('YEARLY', 'MONTHLY', 'QUARTERLY'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_leave_types_max_encash_days') THEN
        ALTER TABLE leave_mgmt.leave_types ADD CONSTRAINT ck_leave_types_max_encash_days
            CHECK (max_encash_days IS NULL OR max_encash_days BETWEEN 1 AND 365);
    END IF;
END $$;

-- ── 2. Leave balance ledger: the audit trail of every automatic change ─────
-- One row per credit / carry forward / lapse / encashment. The unique key
-- (employee, type, kind, period) is what makes each job idempotent: a period
-- that is already on the ledger is never credited twice, however often the
-- job runs or however many instances run it.
CREATE TABLE IF NOT EXISTS leave_mgmt.leave_balance_ledger (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    employee_id     UUID          NOT NULL,
    leave_type_id   UUID          NOT NULL REFERENCES leave_mgmt.leave_types(id) ON DELETE CASCADE,
    year            INTEGER       NOT NULL,
    kind            VARCHAR(20)   NOT NULL,
    period          VARCHAR(64)   NOT NULL,
    days            NUMERIC(7,2)  NOT NULL,
    note            TEXT,
    source_id       UUID,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    CONSTRAINT ck_leave_ledger_kind
        CHECK (kind IN ('ACCRUAL', 'CARRY_FORWARD', 'LAPSE', 'ENCASHMENT'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_leave_ledger_period
    ON leave_mgmt.leave_balance_ledger (tenant_id, employee_id, leave_type_id, kind, period);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_tenant_recent
    ON leave_mgmt.leave_balance_ledger (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_employee_year
    ON leave_mgmt.leave_balance_ledger (tenant_id, employee_id, year);

ALTER TABLE leave_mgmt.leave_balance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_mgmt.leave_balance_ledger FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'leave_mgmt' AND tablename = 'leave_balance_ledger'
                      AND policyname = 'tenant_isolation_leave_ledger') THEN
        CREATE POLICY tenant_isolation_leave_ledger ON leave_mgmt.leave_balance_ledger
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. Leave encashment requests ────────────────────────────────────────────
-- PENDING (days held in the balance's "pending") → APPROVED (days moved to
-- "used"; amount worked out from the current Basic) → PAID (set by payroll
-- when a run pays it, see LeaveEncashmentService.markPaid). REJECTED and
-- CANCELLED give the days back.
CREATE TABLE IF NOT EXISTS leave_mgmt.leave_encashment_requests (
    id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID           NOT NULL,
    employee_id             UUID           NOT NULL,
    leave_type_id           UUID           NOT NULL REFERENCES leave_mgmt.leave_types(id),
    year                    INTEGER        NOT NULL,
    days                    NUMERIC(6,2)   NOT NULL,
    status                  VARCHAR(20)    NOT NULL DEFAULT 'PENDING',
    reason                  TEXT,
    raised_by_employee_id   UUID,
    raised_by_hr            BOOLEAN        NOT NULL DEFAULT FALSE,
    decided_by_employee_id  UUID,
    decided_at              TIMESTAMPTZ,
    decision_note           TEXT,
    per_day_rate            NUMERIC(12,2),
    amount                  NUMERIC(12,2),
    payroll_run_id          UUID,
    paid_at                 TIMESTAMPTZ,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT ck_leave_encash_days CHECK (days > 0 AND days <= 365),
    CONSTRAINT ck_leave_encash_status
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'PAID'))
);
CREATE INDEX IF NOT EXISTS idx_leave_encash_tenant_status
    ON leave_mgmt.leave_encashment_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_encash_employee_year
    ON leave_mgmt.leave_encashment_requests (tenant_id, employee_id, year);

ALTER TABLE leave_mgmt.leave_encashment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_mgmt.leave_encashment_requests FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'leave_mgmt' AND tablename = 'leave_encashment_requests'
                      AND policyname = 'tenant_isolation_leave_encash') THEN
        CREATE POLICY tenant_isolation_leave_encash ON leave_mgmt.leave_encashment_requests
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 4. Shift rules: code, core hours, weekly offs ───────────────────────────
-- weekly_off_days is a CSV of ISO day numbers (1 = Mon … 7 = Sun), the same
-- format as hrms.employees.weekly_off_days. Attendance uses it for people on
-- the shift who have no weekly offs of their own.
ALTER TABLE attendance.shift_policies
    ADD COLUMN IF NOT EXISTS code            VARCHAR(20),
    ADD COLUMN IF NOT EXISTS core_start_time TIME,
    ADD COLUMN IF NOT EXISTS core_end_time   TIME,
    ADD COLUMN IF NOT EXISTS weekly_off_days VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS ux_shift_policies_company_code
    ON attendance.shift_policies (tenant_id, company_id, code)
    WHERE code IS NOT NULL AND is_active;

-- A company whose only shift was the signup "Standard 9-6" never got the
-- standard "General" shift once defaults stopped being re-seeded on every
-- read (§10 #5). Add it once, so the shift pickers offer it. A company that
-- has any other shift (or already has General, active or archived) is left
-- alone; the same rule runs lazily in EmployeeShiftService for new workspaces.
INSERT INTO attendance.shift_policies
    (id, tenant_id, company_id, name, code, shift_type, start_time, end_time,
     grace_period_minutes, working_hours_per_day, overtime_applicable, overtime_multiplier,
     is_active, created_at, updated_at, created_by, updated_by, version)
SELECT gen_random_uuid(), c.tenant_id, c.company_id, 'General', 'GEN', 'FIXED', TIME '09:00', TIME '17:00',
       15, 8.0, FALSE, 1.5, TRUE, now(), now(), 'V143_23', 'V143_23', 0
  FROM (SELECT DISTINCT tenant_id, company_id
          FROM attendance.shift_policies
         WHERE lower(trim(name)) = 'standard 9-6') c
 WHERE NOT EXISTS (SELECT 1 FROM attendance.shift_policies o
                    WHERE o.tenant_id = c.tenant_id AND o.company_id = c.company_id
                      AND lower(trim(o.name)) <> 'standard 9-6');

-- ── 5. Policies: optional acknowledgement, email on publish, reminders ─────
ALTER TABLE policy_mgmt.hr_policies
    ADD COLUMN IF NOT EXISTS acknowledgement_required BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notify_on_publish        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS auto_remind_after_days   INTEGER,
    ADD COLUMN IF NOT EXISTS published_at             TIMESTAMPTZ;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hr_policies_auto_remind_days') THEN
        ALTER TABLE policy_mgmt.hr_policies ADD CONSTRAINT ck_hr_policies_auto_remind_days
            CHECK (auto_remind_after_days IS NULL OR auto_remind_after_days BETWEEN 1 AND 90);
    END IF;
END $$;
-- Policies published before this column existed: their last change is the best
-- known publish time (used only to time the optional automatic reminder).
UPDATE policy_mgmt.hr_policies
   SET published_at = COALESCE(updated_at, created_at)
 WHERE status IN ('ACTIVE', 'ARCHIVED') AND published_at IS NULL;

-- Every email / in-app notice about a policy: an outbox the dispatcher sends
-- from, and the record of who was told what and when. PUBLISHED and
-- AUTO_REMINDER go to a person at most once per policy version (unique index);
-- manual reminders may repeat, but not within 24 hours (enforced in code).
CREATE TABLE IF NOT EXISTS policy_mgmt.policy_notices (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    policy_id       UUID          NOT NULL REFERENCES policy_mgmt.hr_policies(id) ON DELETE CASCADE,
    policy_version  VARCHAR(20)   NOT NULL DEFAULT '',
    employee_id     UUID          NOT NULL,
    kind            VARCHAR(20)   NOT NULL,
    email           VARCHAR(255),
    status          VARCHAR(12)   NOT NULL DEFAULT 'PENDING',
    attempts        INTEGER       NOT NULL DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,
    created_by      VARCHAR(255),
    CONSTRAINT ck_policy_notices_kind CHECK (kind IN ('PUBLISHED', 'REMINDER', 'AUTO_REMINDER')),
    CONSTRAINT ck_policy_notices_status CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_notices_once
    ON policy_mgmt.policy_notices (tenant_id, policy_id, employee_id, kind, policy_version)
    WHERE kind IN ('PUBLISHED', 'AUTO_REMINDER');
CREATE INDEX IF NOT EXISTS idx_policy_notices_pending
    ON policy_mgmt.policy_notices (tenant_id, created_at)
    WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_policy_notices_policy
    ON policy_mgmt.policy_notices (tenant_id, policy_id, employee_id, created_at DESC);

ALTER TABLE policy_mgmt.policy_notices ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'policy_mgmt' AND tablename = 'policy_notices'
                      AND policyname = 'tenant_isolation_policy_notices') THEN
        CREATE POLICY tenant_isolation_policy_notices ON policy_mgmt.policy_notices
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 6. App role grants ──────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA leave_mgmt TO ut_app;
        GRANT USAGE ON SCHEMA policy_mgmt TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON leave_mgmt.leave_balance_ledger TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON leave_mgmt.leave_encashment_requests TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON policy_mgmt.policy_notices TO ut_app;
    END IF;
END $$;

-- ── 7. Permissions ──────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.leave.encash.approve', 'Approve leave encashment', 'hrms',
     'See everyone''s leave encashment requests, raise one for an employee, and approve or reject them. '
     || 'Approved days come off the leave balance straight away and are paid as an earning in the next payroll run.'),
    ('hrms.leave.yearend.run', 'Run leave accrual and year-end carry forward', 'hrms',
     'Credit monthly or quarterly leave now, and run the year-end carry forward. Careful: at year end, '
     || 'unused days above each leave type''s carry-forward cap lapse and can''t be given back from the app. '
     || 'Both also run automatically (accrual daily, carry forward in the first days of January).')
ON CONFLICT (code) DO NOTHING;

-- HR, plus OWNER and SUPER_ADMIN, which must hold every permission
-- (OwnerPermissionInvariantCheck refuses to start the app otherwise). The same
-- roles that configure leave types and give the final (L2) leave approval.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
 CROSS JOIN (VALUES ('hrms.leave.encash.approve'), ('hrms.leave.yearend.run')) AS p(code)
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'HR_MANAGER')
ON CONFLICT DO NOTHING;
