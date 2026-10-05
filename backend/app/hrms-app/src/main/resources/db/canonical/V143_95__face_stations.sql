-- V143.95: face station (common face-punch kiosk, spec 14.4, audit D-06 / D-07).
-- A shared tablet or computer at a branch, signed in as a STATION (not a person), where
-- anyone working at that branch punches in or out with their face. Design:
-- docs/redesign/FACE_STATION.md.
--
-- 1. attendance.face_stations — one row per station: its company and branch, its name, and
--    whether it is ACTIVE or REVOKED. Admin/HR create and revoke them on the website
--    (attendance.policy.manage + attendance.assisted_punch.any, both already granted to
--    OWNER, SUPER_ADMIN, ADMIN and HR_MANAGER). A station's sign-in stops working the moment
--    its row is REVOKED (every station request re-reads it).
-- 2. attendance.station_punches — every punch a station made: which station, which
--    attendance record and face check, the match band, and whether it needs the manager's
--    approval (a match that wasn't certain). Approval itself is the existing face review
--    (attendance.face_event_reviews): confirmed counts, rejected doesn't.
--
-- Safety. Two new tables read and written with JDBC only (no JPA entity maps them), so
-- nothing that exists today changes. No new permission (OwnerPermissionInvariantCheck is
-- unaffected). Until this file is applied the station endpoints answer FEATURE_NOT_READY
-- and the setup page says the feature isn't switched on yet.
--
-- Numbered 143.95 (reserved for this work). Idempotent (IF NOT EXISTS, guarded DO blocks).
-- Production has Flyway OFF: apply by hand, as the table owner (a superuser: row-level
-- security and grants).

-- ── 1. stations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.face_stations (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID          NOT NULL,
    company_id           UUID          NOT NULL,
    branch_id            UUID          NOT NULL,
    name                 VARCHAR(80)   NOT NULL,
    status               VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id   UUID,
    created_by_name      VARCHAR(200),
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    revoked_by_user_id   UUID,
    revoked_by_name      VARCHAR(200),
    revoked_at           TIMESTAMPTZ,
    last_started_at      TIMESTAMPTZ,
    last_started_by_name VARCHAR(200),
    last_used_at         TIMESTAMPTZ,
    CONSTRAINT ck_face_stations_status CHECK (status IN ('ACTIVE', 'REVOKED'))
);
CREATE INDEX IF NOT EXISTS idx_face_stations_company
    ON attendance.face_stations (tenant_id, company_id);

COMMENT ON TABLE attendance.face_stations IS
    'Shared face-punch devices (kiosks), one branch each; REVOKED stops the device at once (V143.95). JDBC only.';

ALTER TABLE attendance.face_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.face_stations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'face_stations'
                      AND policyname = 'tenant_isolation_face_stations') THEN
        CREATE POLICY tenant_isolation_face_stations ON attendance.face_stations
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. punches made at a station ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance.station_punches (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID          NOT NULL,
    station_id            UUID          NOT NULL REFERENCES attendance.face_stations (id),
    attendance_record_id  UUID,
    employee_id           UUID          NOT NULL,
    attendance_date       DATE          NOT NULL,
    punch_type            VARCHAR(10)   NOT NULL,
    punched_at            TIMESTAMPTZ   NOT NULL,
    face_event_id         UUID,
    score_bucket          VARCHAR(20),
    needs_approval        BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_station_punches_type CHECK (punch_type IN ('CHECK_IN', 'CHECK_OUT'))
);
CREATE INDEX IF NOT EXISTS idx_station_punches_station
    ON attendance.station_punches (tenant_id, station_id, punched_at);
CREATE INDEX IF NOT EXISTS idx_station_punches_emp_date
    ON attendance.station_punches (tenant_id, employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_station_punches_face_event
    ON attendance.station_punches (tenant_id, face_event_id);

COMMENT ON TABLE attendance.station_punches IS
    'Every punch a face station made, with the station, the face check and whether the match needs the manager''s approval (V143.95). JDBC only.';

ALTER TABLE attendance.station_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.station_punches FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'attendance' AND tablename = 'station_punches'
                      AND policyname = 'tenant_isolation_station_punches') THEN
        CREATE POLICY tenant_isolation_station_punches ON attendance.station_punches
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. grants for the runtime role ───────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA attendance TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.face_stations TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.station_punches TO ut_app;
    ELSE
        RAISE NOTICE 'V143.95: role ut_app not present — grants skipped';
    END IF;
END $$;
