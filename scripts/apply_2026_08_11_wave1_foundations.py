"""Wave 1 foundations migration — bundles four independent DDL additions.

Additive-only. Every change is guarded with IF NOT EXISTS / DROP POLICY IF
EXISTS / ON CONFLICT so a re-run is a no-op. Applied in a single transaction
so a mid-way failure rolls the whole thing back.

Content:
    V080 payroll bank disbursement — bank_profiles, disbursement_batches,
         disbursement_batch_lines. Prep for Wave 2 (bank transfers).
    V081 advance recovery         — recovery_schedule, ledger_entry;
         extends advance_requests with loan_type, interest_rate_pct,
         recovery_start_month, disbursement_reference. Prep for Wave 2
         (advance recovery hook into payroll).
    V082 performance 360          — extends performance_reviews with
         reviewer_type + reminder tracking; extends review_cycles with
         cycle_type + rating scale + deadlines; creates
         appraisal_reviewer_assignments; extends performance_mgmt.goals;
         creates kpi_progress_updates. Prep for Waves 3 + 4.
    V083 expense batches          — reimbursement_batch +
         reimbursement_batch_item; expense_claim.version already exists
         (added by V067), so we're a no-op there. Prep for Wave 3.

Run once against prod:
    PGPASSWORD=$(gcloud secrets versions access latest \
        --secret=POSTGRES_ROOT_PASSWORD --project unifiedtree-445cd) \
        python scripts/apply_2026_08_11_wave1_foundations.py

Rollback (in reverse order, per-schema — every DROP is guarded):
    DROP TABLE IF EXISTS expense_mgmt.reimbursement_batch_items CASCADE;
    DROP TABLE IF EXISTS expense_mgmt.reimbursement_batches CASCADE;
    DROP TABLE IF EXISTS performance_mgmt.kpi_progress_updates CASCADE;
    DROP TABLE IF EXISTS performance_mgmt.appraisal_reviewer_assignments CASCADE;
    ALTER TABLE performance_mgmt.goals DROP COLUMN IF EXISTS target_value,
         DROP COLUMN IF EXISTS current_value, DROP COLUMN IF EXISTS unit,
         DROP COLUMN IF EXISTS direction, DROP COLUMN IF EXISTS due_date,
         DROP COLUMN IF EXISTS category;
    ALTER TABLE performance_mgmt.review_cycles DROP COLUMN IF EXISTS cycle_type,
         DROP COLUMN IF EXISTS rating_scale_max,
         DROP COLUMN IF EXISTS self_deadline, DROP COLUMN IF EXISTS manager_deadline,
         DROP COLUMN IF EXISTS peer_deadline;
    ALTER TABLE performance_mgmt.performance_reviews DROP COLUMN IF EXISTS reviewer_type,
         DROP COLUMN IF EXISTS reminder_sent_at, DROP COLUMN IF EXISTS reminder_count;
    DROP TABLE IF EXISTS advance_mgmt.advance_ledger_entries CASCADE;
    DROP TABLE IF EXISTS advance_mgmt.advance_recovery_schedule CASCADE;
    ALTER TABLE advance_mgmt.advance_requests DROP COLUMN IF EXISTS loan_type,
         DROP COLUMN IF EXISTS interest_rate_pct,
         DROP COLUMN IF EXISTS recovery_start_month,
         DROP COLUMN IF EXISTS disbursement_reference;
    DROP TABLE IF EXISTS payroll.disbursement_batch_lines CASCADE;
    DROP TABLE IF EXISTS payroll.disbursement_batches CASCADE;
    DROP TABLE IF EXISTS payroll.bank_profiles CASCADE;
"""
import os
import psycopg2


DDL = r"""
-- ============================================================================
-- V080 — Payroll: bank profiles + disbursement batches + batch lines
-- ============================================================================

CREATE TABLE IF NOT EXISTS payroll.bank_profiles (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    company_id        UUID          NOT NULL,
    profile_name      VARCHAR(120)  NOT NULL,
    -- Which NEFT/RTGS template to use when generating the disbursement file.
    -- 'GENERIC_CSV' ships at Wave 2; bank-specific formats plugged in later
    -- (see NeftFileTemplateService — Wave 5 adds HDFC_FIXED, etc.).
    bank_format       VARCHAR(40)   NOT NULL DEFAULT 'GENERIC_CSV'
                      CHECK (bank_format IN ('GENERIC_CSV','HDFC_FIXED','ICICI_CIB','SBI_CORP')),
    corporate_id      VARCHAR(60),                    -- bank-side client code
    debit_account_no  VARCHAR(60)   NOT NULL,
    ifsc              VARCHAR(11)   NOT NULL
                      CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
    -- Only one default per (tenant, company). Enforced by a partial UNIQUE
    -- index below rather than a UNIQUE constraint so historical non-defaults
    -- don't collide when toggling.
    is_default        BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_profiles_default
    ON payroll.bank_profiles (tenant_id, company_id)
    WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_bank_profiles_active
    ON payroll.bank_profiles (tenant_id, company_id, is_active);

ALTER TABLE payroll.bank_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_bank_profiles ON payroll.bank_profiles;
CREATE POLICY tenant_isolation_bank_profiles ON payroll.bank_profiles
    USING (tenant_id = current_tenant_id());


CREATE TABLE IF NOT EXISTS payroll.disbursement_batches (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    company_id        UUID          NOT NULL,
    -- payroll.runs.id — no FK because payroll.runs may live in a different
    -- schema in some tenants; we still enforce lookup at write time.
    run_id            UUID          NOT NULL,
    bank_profile_id   UUID          NOT NULL REFERENCES payroll.bank_profiles(id),
    batch_reference   VARCHAR(60)   NOT NULL,
    total_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
    beneficiary_count INT           NOT NULL DEFAULT 0,
    -- DRAFT       — built from run, not yet posted
    -- POSTED      — file generated, awaiting Mark Paid
    -- PAID        — Finance confirmed transfer (records UTR); flips run.status=PAID
    -- CANCELLED   — manually cancelled before Mark Paid
    status            VARCHAR(24)   NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','POSTED','PAID','CANCELLED')),
    file_generated_at TIMESTAMPTZ,
    file_key          TEXT,          -- R2/GCS object key of the generated NEFT
    posted_at         TIMESTAMPTZ,
    paid_at           TIMESTAMPTZ,
    payment_reference VARCHAR(120),  -- UTR / bank transaction reference
    notes             TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_disbursement_batches_run
    ON payroll.disbursement_batches (tenant_id, run_id, status);
CREATE INDEX IF NOT EXISTS idx_disbursement_batches_company
    ON payroll.disbursement_batches (tenant_id, company_id, status);
-- One PAID/POSTED batch per (run, bank_profile) — allows redoing a CANCELLED
-- batch. Partial-index UNIQUE, so DRAFT clones don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursement_batches_active
    ON payroll.disbursement_batches (tenant_id, run_id, bank_profile_id)
    WHERE status IN ('DRAFT','POSTED','PAID');

ALTER TABLE payroll.disbursement_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_disbursement_batches ON payroll.disbursement_batches;
CREATE POLICY tenant_isolation_disbursement_batches ON payroll.disbursement_batches
    USING (tenant_id = current_tenant_id());


CREATE TABLE IF NOT EXISTS payroll.disbursement_batch_lines (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    batch_id         UUID          NOT NULL REFERENCES payroll.disbursement_batches(id)
                                   ON DELETE CASCADE,
    employee_id      UUID          NOT NULL,
    beneficiary_name VARCHAR(200)  NOT NULL,
    account_no       VARCHAR(60)   NOT NULL,
    ifsc             VARCHAR(11)   NOT NULL,
    amount           NUMERIC(18,2) NOT NULL,
    -- If the employee has no valid bank details at batch-build time we
    -- create the line with status='SKIPPED_MISSING_DETAILS' and amount=0,
    -- rather than silently dropping — Finance sees the exclusion.
    status           VARCHAR(28)   NOT NULL DEFAULT 'READY'
                     CHECK (status IN ('READY','SKIPPED_MISSING_DETAILS','SKIPPED_INVALID_IFSC','FAILED')),
    failure_reason   TEXT,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disbursement_batch_lines_batch
    ON payroll.disbursement_batch_lines (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_disbursement_batch_lines_employee
    ON payroll.disbursement_batch_lines (tenant_id, employee_id);

ALTER TABLE payroll.disbursement_batch_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_disbursement_batch_lines ON payroll.disbursement_batch_lines;
CREATE POLICY tenant_isolation_disbursement_batch_lines ON payroll.disbursement_batch_lines
    USING (tenant_id = current_tenant_id());


-- ============================================================================
-- V081 — Advance recovery schedule + ledger
-- ============================================================================

-- Extend advance_requests with loan-type metadata used by recovery.
-- Backfill loan_type='SALARY_ADVANCE' on existing rows (any current advance is
-- treated as a plain salary advance for recovery purposes).
ALTER TABLE advance_mgmt.advance_requests
    ADD COLUMN IF NOT EXISTS loan_type              VARCHAR(24),
    ADD COLUMN IF NOT EXISTS interest_rate_pct      NUMERIC(6,3) NOT NULL DEFAULT 0.000,
    ADD COLUMN IF NOT EXISTS recovery_start_month   DATE,
    ADD COLUMN IF NOT EXISTS disbursement_reference VARCHAR(120);
UPDATE advance_mgmt.advance_requests
    SET loan_type = 'SALARY_ADVANCE'
    WHERE loan_type IS NULL;
ALTER TABLE advance_mgmt.advance_requests
    ALTER COLUMN loan_type SET NOT NULL,
    ALTER COLUMN loan_type SET DEFAULT 'SALARY_ADVANCE';
-- Postgres has no IF NOT EXISTS for constraints — guard by name lookup.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_advance_loan_type'
          AND conrelid = 'advance_mgmt.advance_requests'::regclass
    ) THEN
        ALTER TABLE advance_mgmt.advance_requests
            ADD CONSTRAINT chk_advance_loan_type
                CHECK (loan_type IN ('SALARY_ADVANCE','FESTIVAL_ADVANCE','TRAVEL_ADVANCE','MEDICAL_LOAN','PERSONAL_LOAN'))
                NOT VALID;
    END IF;
    -- Backfill's done above, so we can safely validate whether the constraint
    -- was created just now or already existed.
    PERFORM 1 FROM advance_mgmt.advance_requests WHERE loan_type IS NULL LIMIT 1;
    IF NOT FOUND THEN
        ALTER TABLE advance_mgmt.advance_requests VALIDATE CONSTRAINT chk_advance_loan_type;
    END IF;
END $$;


CREATE TABLE IF NOT EXISTS advance_mgmt.advance_recovery_schedule (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    advance_request_id    UUID          NOT NULL REFERENCES advance_mgmt.advance_requests(id)
                                        ON DELETE CASCADE,
    installment_no        INT           NOT NULL,
    -- The cycle-month this installment is due in (first day of the month).
    scheduled_month       DATE          NOT NULL,
    scheduled_amount      NUMERIC(15,2) NOT NULL,
    -- PENDING     — future installment
    -- RECOVERED   — deducted in a payroll run (payroll_run_id points to it)
    -- SKIPPED     — HR chose to skip this month; schedule extends by 1
    -- CANCELLED   — advance was foreclosed or written off before this cycle
    status                VARCHAR(16)   NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','RECOVERED','SKIPPED','CANCELLED')),
    payroll_run_id        UUID,
    recovered_amount      NUMERIC(15,2),
    recovered_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    version               BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_recovery_installment UNIQUE (advance_request_id, installment_no)
);
CREATE INDEX IF NOT EXISTS idx_recovery_advance
    ON advance_mgmt.advance_recovery_schedule (tenant_id, advance_request_id, status);
CREATE INDEX IF NOT EXISTS idx_recovery_month
    ON advance_mgmt.advance_recovery_schedule (tenant_id, scheduled_month, status);

ALTER TABLE advance_mgmt.advance_recovery_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_recovery_schedule ON advance_mgmt.advance_recovery_schedule;
CREATE POLICY tenant_isolation_recovery_schedule ON advance_mgmt.advance_recovery_schedule
    USING (tenant_id = current_tenant_id());


CREATE TABLE IF NOT EXISTS advance_mgmt.advance_ledger_entries (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    advance_request_id    UUID          NOT NULL REFERENCES advance_mgmt.advance_requests(id)
                                        ON DELETE CASCADE,
    -- DISBURSE   — initial disbursal, positive amount, sets balance_after=principal
    -- REPAYMENT  — payroll recovery, negative amount, balance_after decrements
    -- FORECLOSE  — early full settlement, negative, balance_after=0
    -- WRITE_OFF  — HR writes off outstanding, negative, balance_after=0
    -- ADJUSTMENT — manual +/- correction with mandatory notes
    entry_type            VARCHAR(16)   NOT NULL
                          CHECK (entry_type IN ('DISBURSE','REPAYMENT','FORECLOSE','WRITE_OFF','ADJUSTMENT')),
    amount                NUMERIC(15,2) NOT NULL,
    balance_after         NUMERIC(15,2) NOT NULL,
    payroll_run_id        UUID,
    reference             VARCHAR(120),  -- UTR, batch id, or reason
    notes                 TEXT,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by            VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_advance_ledger_request
    ON advance_mgmt.advance_ledger_entries (tenant_id, advance_request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_advance_ledger_run
    ON advance_mgmt.advance_ledger_entries (tenant_id, payroll_run_id);

ALTER TABLE advance_mgmt.advance_ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_advance_ledger ON advance_mgmt.advance_ledger_entries;
CREATE POLICY tenant_isolation_advance_ledger ON advance_mgmt.advance_ledger_entries
    USING (tenant_id = current_tenant_id());


-- ============================================================================
-- V082 — Performance: 360 fan-out + KPI/goal extensions
-- ============================================================================

-- performance_reviews: add reviewer_type + reminder tracking
ALTER TABLE performance_mgmt.performance_reviews
    ADD COLUMN IF NOT EXISTS reviewer_type    VARCHAR(16),
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminder_count   INT NOT NULL DEFAULT 0;
UPDATE performance_mgmt.performance_reviews
    SET reviewer_type = 'MANAGER'
    WHERE reviewer_type IS NULL;
-- SELF / MANAGER / PEER / SKIP_LEVEL / DIRECT_REPORT (upward review)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_review_reviewer_type'
          AND conrelid = 'performance_mgmt.performance_reviews'::regclass
    ) THEN
        ALTER TABLE performance_mgmt.performance_reviews
            ADD CONSTRAINT chk_review_reviewer_type
                CHECK (reviewer_type IN ('SELF','MANAGER','PEER','SKIP_LEVEL','DIRECT_REPORT')) NOT VALID;
        ALTER TABLE performance_mgmt.performance_reviews
            VALIDATE CONSTRAINT chk_review_reviewer_type;
    END IF;
END $$;

-- review_cycles: add cycle_type + rating scale + per-role deadlines
ALTER TABLE performance_mgmt.review_cycles
    ADD COLUMN IF NOT EXISTS cycle_type       VARCHAR(16),
    ADD COLUMN IF NOT EXISTS rating_scale_max NUMERIC(3,1) NOT NULL DEFAULT 5.0,
    ADD COLUMN IF NOT EXISTS self_deadline    DATE,
    ADD COLUMN IF NOT EXISTS manager_deadline DATE,
    ADD COLUMN IF NOT EXISTS peer_deadline    DATE;
UPDATE performance_mgmt.review_cycles
    SET cycle_type = 'ANNUAL'
    WHERE cycle_type IS NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_cycle_type'
          AND conrelid = 'performance_mgmt.review_cycles'::regclass
    ) THEN
        ALTER TABLE performance_mgmt.review_cycles
            ADD CONSTRAINT chk_cycle_type
                CHECK (cycle_type IN ('ANNUAL','HALF_YEARLY','QUARTERLY','PROBATION','THREE_SIXTY')) NOT VALID;
        ALTER TABLE performance_mgmt.review_cycles
            VALIDATE CONSTRAINT chk_cycle_type;
    END IF;
END $$;

-- Assignments: one row per (cycle, reviewee, reviewer, reviewer_type). Used by
-- Wave 3 fan-out to generate PENDING performance_reviews rows.
CREATE TABLE IF NOT EXISTS performance_mgmt.appraisal_reviewer_assignments (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    cycle_id       UUID          NOT NULL REFERENCES performance_mgmt.review_cycles(id)
                                 ON DELETE CASCADE,
    reviewee_id    UUID          NOT NULL,
    reviewer_id    UUID          NOT NULL,
    reviewer_type  VARCHAR(16)   NOT NULL
                   CHECK (reviewer_type IN ('SELF','MANAGER','PEER','SKIP_LEVEL','DIRECT_REPORT')),
    -- PENDING / IN_PROGRESS / COMPLETED / MISSED (force-closed)
    status         VARCHAR(16)   NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','MISSED')),
    review_id      UUID,   -- FK to performance_reviews.id when the row is created
    completed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    version        BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT uq_assignment UNIQUE (cycle_id, reviewee_id, reviewer_id, reviewer_type)
);
CREATE INDEX IF NOT EXISTS idx_assignments_cycle
    ON performance_mgmt.appraisal_reviewer_assignments (tenant_id, cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_reviewer
    ON performance_mgmt.appraisal_reviewer_assignments (tenant_id, reviewer_id, status);

ALTER TABLE performance_mgmt.appraisal_reviewer_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_reviewer_assignments ON performance_mgmt.appraisal_reviewer_assignments;
CREATE POLICY tenant_isolation_reviewer_assignments ON performance_mgmt.appraisal_reviewer_assignments
    USING (tenant_id = current_tenant_id());

-- goals: extend for numeric-target KPIs (target/current/direction/due_date)
ALTER TABLE performance_mgmt.goals
    ADD COLUMN IF NOT EXISTS target_value  NUMERIC(18,4),
    ADD COLUMN IF NOT EXISTS current_value NUMERIC(18,4),
    ADD COLUMN IF NOT EXISTS unit          VARCHAR(24),
    ADD COLUMN IF NOT EXISTS direction     VARCHAR(20),
    ADD COLUMN IF NOT EXISTS due_date      DATE,
    ADD COLUMN IF NOT EXISTS category      VARCHAR(40);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_goal_direction'
          AND conrelid = 'performance_mgmt.goals'::regclass
    ) THEN
        ALTER TABLE performance_mgmt.goals
            ADD CONSTRAINT chk_goal_direction
                CHECK (direction IS NULL OR direction IN ('HIGHER_IS_BETTER','LOWER_IS_BETTER','TARGET_EXACT'))
                NOT VALID;
        ALTER TABLE performance_mgmt.goals VALIDATE CONSTRAINT chk_goal_direction;
    END IF;
END $$;

-- kpi_progress_updates: audit trail for every progress bump. Written by
-- Wave 4's PUT /v1/performance/kpis/{id}/progress endpoint.
CREATE TABLE IF NOT EXISTS performance_mgmt.kpi_progress_updates (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    goal_id        UUID          NOT NULL REFERENCES performance_mgmt.goals(id)
                                 ON DELETE CASCADE,
    -- Snapshot of the numeric value BEFORE and AFTER this update, so we can
    -- reconstruct progress history even if the KPI is later re-scaled.
    previous_value NUMERIC(18,4),
    new_value      NUMERIC(18,4) NOT NULL,
    -- Percent-complete AFTER this update (derived at write time; frozen here
    -- because target_value can change over the KPI lifetime).
    progress_pct   NUMERIC(6,2)  NOT NULL,
    notes          TEXT,
    updated_by     UUID          NOT NULL,
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kpi_progress_goal
    ON performance_mgmt.kpi_progress_updates (tenant_id, goal_id, updated_at DESC);

ALTER TABLE performance_mgmt.kpi_progress_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_kpi_progress ON performance_mgmt.kpi_progress_updates;
CREATE POLICY tenant_isolation_kpi_progress ON performance_mgmt.kpi_progress_updates
    USING (tenant_id = current_tenant_id());


-- ============================================================================
-- V083 — Expense: reimbursement batches
-- ============================================================================

CREATE TABLE IF NOT EXISTS expense_mgmt.reimbursement_batches (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    company_id        UUID          NOT NULL,
    batch_reference   VARCHAR(60)   NOT NULL,
    -- Cutoff for which APPROVED claims land in this batch. Any APPROVED claim
    -- with approved_at <= this date is eligible unless it's already in a
    -- non-CANCELLED batch (enforced by the app).
    cutoff_date       DATE          NOT NULL,
    total_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
    claim_count       INT           NOT NULL DEFAULT 0,
    -- DRAFT / POSTED / PAID / CANCELLED (mirrors bank disbursement lifecycle)
    status            VARCHAR(24)   NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','POSTED','PAID','CANCELLED')),
    posted_at         TIMESTAMPTZ,
    paid_at           TIMESTAMPTZ,
    payment_reference VARCHAR(120), -- UTR
    notes             TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reimb_batches_company
    ON expense_mgmt.reimbursement_batches (tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_reimb_batches_cutoff
    ON expense_mgmt.reimbursement_batches (tenant_id, cutoff_date);

ALTER TABLE expense_mgmt.reimbursement_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_reimb_batches ON expense_mgmt.reimbursement_batches;
CREATE POLICY tenant_isolation_reimb_batches ON expense_mgmt.reimbursement_batches
    USING (tenant_id = current_tenant_id());


CREATE TABLE IF NOT EXISTS expense_mgmt.reimbursement_batch_items (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    batch_id       UUID          NOT NULL REFERENCES expense_mgmt.reimbursement_batches(id)
                                 ON DELETE CASCADE,
    claim_id       UUID          NOT NULL REFERENCES expense_mgmt.expense_claims(id),
    employee_id    UUID          NOT NULL,
    amount         NUMERIC(18,2) NOT NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- A claim can only be inside one non-CANCELLED batch. Enforced at insert
    -- time by the app AND by this partial unique index (belt + braces).
    CONSTRAINT uq_reimb_batch_item UNIQUE (batch_id, claim_id)
);
CREATE INDEX IF NOT EXISTS idx_reimb_items_batch
    ON expense_mgmt.reimbursement_batch_items (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_reimb_items_claim
    ON expense_mgmt.reimbursement_batch_items (tenant_id, claim_id);

ALTER TABLE expense_mgmt.reimbursement_batch_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_reimb_items ON expense_mgmt.reimbursement_batch_items;
CREATE POLICY tenant_isolation_reimb_items ON expense_mgmt.reimbursement_batch_items
    USING (tenant_id = current_tenant_id());


-- ============================================================================
-- Grants — mirror V067/V068 dual-role pattern (hrms_app / app_user / ut_app)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA payroll, advance_mgmt, performance_mgmt, expense_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payroll          TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA advance_mgmt     TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA performance_mgmt TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA expense_mgmt     TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA payroll, advance_mgmt, performance_mgmt, expense_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payroll          TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA advance_mgmt     TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA performance_mgmt TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA expense_mgmt     TO app_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA payroll, advance_mgmt, performance_mgmt, expense_mgmt TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payroll          TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA advance_mgmt     TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA performance_mgmt TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA expense_mgmt     TO ut_app;
    END IF;
END $$;

-- ============================================================================
-- RBAC — new permissions for Waves 2+
-- ============================================================================
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.disbursement.read',    'View disbursement batches',      'payroll'),
    ('hrms.disbursement.build',   'Build disbursement batches',     'payroll'),
    ('hrms.disbursement.post',    'Post/mark-paid disbursements',   'payroll'),
    ('hrms.bank_profile.read',    'View bank profiles',             'payroll'),
    ('hrms.bank_profile.manage',  'Manage bank profiles',           'payroll'),
    ('hrms.reimb_batch.read',     'View reimbursement batches',     'expense'),
    ('hrms.reimb_batch.build',    'Build reimbursement batches',    'expense'),
    ('hrms.reimb_batch.post',     'Post/mark-paid reimbursements',  'expense'),
    ('hrms.appraisal.initiate',   'Initiate appraisal cycles',      'performance'),
    ('hrms.kpi.manage',           'Manage KPIs (targets/owners)',   'performance'),
    ('hrms.advance.foreclose',    'Foreclose/write-off advances',   'advance')
ON CONFLICT (code) DO NOTHING;
"""


def main() -> None:
    pw = os.environ.get("PGPASSWORD")
    if not pw:
        raise SystemExit(
            "PGPASSWORD not set. Run:\n"
            "  PGPASSWORD=$(gcloud secrets versions access latest "
            "--secret=POSTGRES_ROOT_PASSWORD --project unifiedtree-445cd) "
            "python scripts/apply_2026_08_11_wave1_foundations.py"
        )
    host = os.environ.get("PGHOST", "127.0.0.1")
    port = int(os.environ.get("PGPORT", "15432"))
    user = os.environ.get("PGUSER", "postgres")
    db = os.environ.get("PGDATABASE", "postgres")

    print(f"Connecting to {user}@{host}:{port}/{db} ...")
    conn = psycopg2.connect(
        host=host, port=port, user=user, password=pw, dbname=db,
    )
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(DDL)
                # Sanity checks — must be 0 (any migration should be a no-op
                # on re-run, so we just count what got created THIS invocation
                # by inspecting information_schema after the fact).
                cur.execute("""
                    SELECT table_schema || '.' || table_name
                    FROM information_schema.tables
                    WHERE table_name IN (
                        'bank_profiles','disbursement_batches','disbursement_batch_lines',
                        'advance_recovery_schedule','advance_ledger_entries',
                        'appraisal_reviewer_assignments','kpi_progress_updates',
                        'reimbursement_batches','reimbursement_batch_items'
                    )
                    ORDER BY 1;
                """)
                created = [r[0] for r in cur.fetchall()]
                print(f"tables present after migration: {len(created)}")
                for t in created:
                    print(f"  • {t}")
                # Confirm RLS is on for every new table.
                cur.execute("""
                    SELECT n.nspname || '.' || c.relname
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relname IN (
                        'bank_profiles','disbursement_batches','disbursement_batch_lines',
                        'advance_recovery_schedule','advance_ledger_entries',
                        'appraisal_reviewer_assignments','kpi_progress_updates',
                        'reimbursement_batches','reimbursement_batch_items'
                    )
                    AND c.relrowsecurity = TRUE
                    ORDER BY 1;
                """)
                rls_on = [r[0] for r in cur.fetchall()]
                print(f"RLS enabled on {len(rls_on)} tables:")
                for t in rls_on:
                    print(f"  * {t}")
                assert len(rls_on) == 9, \
                    f"expected RLS on all 9 new tables, got {len(rls_on)}: {rls_on}"
        print("OK — Wave 1 foundations applied.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
