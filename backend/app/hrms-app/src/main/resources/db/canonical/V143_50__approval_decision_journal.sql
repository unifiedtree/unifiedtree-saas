-- V143.50: the approval Undo journal (HRMS redesign BW-06, package P-TEAM).
--
-- hrms.approval_decisions: one row for every approve or reject of a leave,
-- work-from-home, attendance fix, shift change or expense claim, from any path
-- (web pages, the mobile app, the Approvals inbox). It keeps what the request
-- looked like before the decision (prior_state) and right after it
-- (post_state, post_version), so the person who decided can take the decision
-- back within 10 minutes (undo_until) while nothing downstream has used it.
--
-- Read and written with JDBC only: no JPA entity maps this table, so no entity
-- changes. When this table is missing, decisions work exactly as before and no
-- Undo is offered (the recorder looks the table up first).
--
-- No new permission: Undo uses each kind's own decide permission.
--
-- Idempotent. Production has Flyway OFF: apply by hand, as a superuser
-- (row-level security).

CREATE TABLE IF NOT EXISTS hrms.approval_decisions (
    id                      UUID         NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               UUID         NOT NULL,
    kind                    VARCHAR(20)  NOT NULL,
    request_id              UUID         NOT NULL,
    employee_id             UUID         NOT NULL,
    decision                VARCHAR(10)  NOT NULL,
    decided_status          VARCHAR(20)  NOT NULL,
    decision_path           VARCHAR(20)  NOT NULL DEFAULT 'DECISION',
    decided_by_employee_id  UUID         NOT NULL,
    decided_by_user_id      UUID,
    decided_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    undo_until              TIMESTAMPTZ  NOT NULL,
    prior_state             JSONB        NOT NULL,
    post_state              JSONB,
    post_version            BIGINT,
    note                    VARCHAR(500),
    summary                 VARCHAR(300),
    undone_at               TIMESTAMPTZ,
    undone_by_employee_id   UUID,
    undone_by_user_id       UUID,
    CONSTRAINT pk_approval_decisions PRIMARY KEY (tenant_id, id),
    CONSTRAINT ck_approval_decisions_kind CHECK (kind IN ('LEAVE', 'WFH', 'CORRECTION', 'SHIFT_CHANGE', 'EXPENSE')),
    CONSTRAINT ck_approval_decisions_decision CHECK (decision IN ('APPROVED', 'REJECTED')),
    CONSTRAINT ck_approval_decisions_path CHECK (decision_path IN ('DECISION', 'L1', 'L2'))
);

-- "My recent decisions" (the caller's own, newest first) and "the decision on this request".
CREATE INDEX IF NOT EXISTS idx_approval_decisions_decider
    ON hrms.approval_decisions (tenant_id, decided_by_employee_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_request
    ON hrms.approval_decisions (tenant_id, kind, request_id, decided_at DESC);

COMMENT ON TABLE hrms.approval_decisions IS
    'Every approve / reject of a leave, WFH, attendance fix, shift change or expense claim, with the state before and after, so the decider can take it back within 10 minutes (V143.50, redesign BW-06). JDBC only.';
COMMENT ON COLUMN hrms.approval_decisions.kind IS 'LEAVE, WFH, CORRECTION, SHIFT_CHANGE or EXPENSE.';
COMMENT ON COLUMN hrms.approval_decisions.decided_status IS 'The status the request got: APPROVED, REJECTED, or PENDING_L2 for a first-level leave approval.';
COMMENT ON COLUMN hrms.approval_decisions.decision_path IS 'Leave only: DECISION (single step), L1 or L2. Every other kind: DECISION.';
COMMENT ON COLUMN hrms.approval_decisions.prior_state IS 'The request (and what the decision changed: leave balance, attendance record, shift assignments) as it was before the decision.';
COMMENT ON COLUMN hrms.approval_decisions.post_state IS 'The same, right after the decision. Undo is refused when anything has changed since.';
COMMENT ON COLUMN hrms.approval_decisions.undo_until IS 'decided_at + 10 minutes.';

ALTER TABLE hrms.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.approval_decisions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'approval_decisions'
                      AND policyname = 'tenant_isolation_approval_decisions') THEN
        CREATE POLICY tenant_isolation_approval_decisions ON hrms.approval_decisions
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── grants for the runtime role ──────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        -- No DELETE: the app only adds rows and marks them undone.
        GRANT SELECT, INSERT, UPDATE ON hrms.approval_decisions TO ut_app;
    ELSE
        RAISE NOTICE 'V143.50: role ut_app not present — grants skipped';
    END IF;
END $$;
