-- V143.58: "Ask payroll" — questions employees ask about one of their payslips,
-- and the payroll team's answers (HRMS redesign BW-59, package P-PAY-CORE).
--
-- payroll.payslip_queries: one row per question. The employee raises it from
-- My payslips about a LOCKED or PAID payslip of their own
-- (POST /v1/payroll/payslips/me/{runId}/queries, payroll.payslip.read.self);
-- people who hold payroll.runs.manage list and answer them
-- (GET /v1/payroll/queries, POST /v1/payroll/queries/{id}/answer).
-- Status: OPEN until answered, then ANSWERED. CLOSED is reserved; nothing sets it yet.
-- The notifications (payroll.payslip_query_raised / _answered) never carry the
-- question or the answer: they are read here, with the payslip.
--
-- Read and written with JDBC only: no JPA entity maps this table, so no entity
-- changes. While this table is missing the endpoints answer 503
-- FEATURE_NOT_READY and the pages hide "Ask payroll".
--
-- No new permission: the employee side uses payroll.payslip.read.self and the
-- payroll team's side payroll.runs.manage, both granted today.
--
-- Idempotent. Production has Flyway OFF: apply by hand, as a superuser
-- (row-level security).

CREATE TABLE IF NOT EXISTS payroll.payslip_queries (
    id                       UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id                UUID          NOT NULL,
    run_id                   UUID          NOT NULL,
    employee_id              UUID          NOT NULL,
    company_id               UUID,
    message                  TEXT          NOT NULL,
    status                   VARCHAR(10)   NOT NULL DEFAULT 'OPEN',
    answer                   TEXT,
    raised_by_user_id        UUID,
    answered_by_user_id      UUID,
    answered_by_employee_id  UUID,
    answered_at              TIMESTAMPTZ,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_payslip_queries PRIMARY KEY (tenant_id, id),
    -- A run removed from the database takes its questions with it (runs are
    -- never deleted by the app; only local test fixtures are).
    CONSTRAINT fk_payslip_queries_run FOREIGN KEY (run_id) REFERENCES payroll.runs(id) ON DELETE CASCADE,
    CONSTRAINT ck_payslip_queries_status CHECK (status IN ('OPEN', 'ANSWERED', 'CLOSED')),
    CONSTRAINT ck_payslip_queries_message CHECK (char_length(btrim(message)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_payslip_queries_answer CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 1 AND 2000),
    CONSTRAINT ck_payslip_queries_answered CHECK (status = 'OPEN' OR answer IS NOT NULL OR status = 'CLOSED')
);

-- "My questions" (newest first), the payroll team's queue by status, and a run's questions.
CREATE INDEX IF NOT EXISTS idx_payslip_queries_employee
    ON payroll.payslip_queries (tenant_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payslip_queries_status
    ON payroll.payslip_queries (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payslip_queries_run
    ON payroll.payslip_queries (tenant_id, run_id);

COMMENT ON TABLE payroll.payslip_queries IS
    'Questions employees ask the payroll team about one of their LOCKED or PAID payslips, with the answer (V143.58, redesign BW-59 "Ask payroll"). JDBC only.';
COMMENT ON COLUMN payroll.payslip_queries.message IS 'The employee''s question (1–1000 characters). Never copied into a notification.';
COMMENT ON COLUMN payroll.payslip_queries.status IS 'OPEN until answered, then ANSWERED. CLOSED is reserved.';
COMMENT ON COLUMN payroll.payslip_queries.answer IS 'The payroll team''s answer (1–2000 characters). Never copied into a notification.';
COMMENT ON COLUMN payroll.payslip_queries.company_id IS 'The run''s company, so the payroll team can tell companies apart.';

ALTER TABLE payroll.payslip_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payslip_queries FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'payroll' AND tablename = 'payslip_queries'
                      AND policyname = 'tenant_isolation_payslip_queries') THEN
        CREATE POLICY tenant_isolation_payslip_queries ON payroll.payslip_queries
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── grants for the runtime role ──────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA payroll TO ut_app;
        -- No DELETE: questions are kept with the payslip.
        GRANT SELECT, INSERT, UPDATE ON payroll.payslip_queries TO ut_app;
    ELSE
        RAISE NOTICE 'V143.58: role ut_app not present — grants skipped';
    END IF;
END $$;
