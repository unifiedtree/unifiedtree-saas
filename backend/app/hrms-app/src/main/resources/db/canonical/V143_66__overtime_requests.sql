-- V143.66: employees ask for overtime on a day they choose (redesign P-ATT-PLAN, DECISIONS 22, 2 Oct 2026).
--
-- Overtime today is worked out from punches: attendance.records.overtime_minutes,
-- decided through attendance.overtime_decisions (keyed to that record and its
-- stored minutes). A request names its own day, minutes and reason and may be for
-- a day with no punch record yet, so it can't live in those tables without
-- changing what they mean. It gets its own table.
--
-- attendance.overtime_requests: one row per request. PENDING until the approver
-- (attendance.overtime.approve, within their team) approves or rejects it, or the
-- employee withdraws it (CANCELLED). At most one waiting or approved request per
-- person and day. Approving records the overtime; it never changes pay, stored
-- punch overtime or work hours (overtime is recorded, not paid).
--
-- Read and written with JDBC only (OvertimeRequestService); no JPA entity maps it.
-- No new permission: asking needs attendance.checkin.self, deciding
-- attendance.overtime.approve, reading the team's list attendance.team.read.
--
-- Idempotent (IF NOT EXISTS, guarded DO blocks). Production has Flyway OFF:
-- apply by hand, as a superuser (row-level security, grants).

CREATE TABLE IF NOT EXISTS attendance.overtime_requests (
    tenant_id       UUID          NOT NULL,
    id              UUID          NOT NULL DEFAULT gen_random_uuid(),
    employee_id     UUID          NOT NULL,
    company_id      UUID,
    request_date    DATE          NOT NULL,
    minutes         INTEGER       NOT NULL,
    reason          VARCHAR(500)  NOT NULL,
    status          VARCHAR(16)   NOT NULL DEFAULT 'PENDING',
    decided_by      UUID,
    decision_note   VARCHAR(1000),
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_overtime_requests PRIMARY KEY (tenant_id, id),
    CONSTRAINT ck_overtime_requests_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT ck_overtime_requests_minutes CHECK (minutes BETWEEN 1 AND 1440)
);

-- One waiting or approved request per person and day; a rejected or withdrawn one doesn't block asking again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_overtime_requests_open_per_day
    ON attendance.overtime_requests (tenant_id, employee_id, request_date)
    WHERE status IN ('PENDING', 'APPROVED');
CREATE INDEX IF NOT EXISTS idx_overtime_requests_date
    ON attendance.overtime_requests (tenant_id, request_date);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_status
    ON attendance.overtime_requests (tenant_id, status);

COMMENT ON TABLE attendance.overtime_requests IS
    'Overtime an employee asked for on a day they chose, with the approver''s decision. Recorded, not paid (V143.66).';

ALTER TABLE attendance.overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.overtime_requests FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'overtime_requests'
                      AND policyname = 'tenant_isolation_overtime_requests') THEN
        CREATE POLICY tenant_isolation_overtime_requests ON attendance.overtime_requests
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA attendance TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.overtime_requests TO ut_app;
    ELSE
        RAISE NOTICE 'V143.66: role ut_app not present — grants skipped';
    END IF;
END $$;
