-- V143.53: web check-in (behind a company switch) and "punch from anywhere" per person
-- (HRMS redesign, package P-ATT-DAY: BW-24, BW-28).
--
-- 1. settings.hr_configuration.allow_web_punch — the company switch "Allow web
--    check-in", ON by default (client decision, 1 Oct): adding the column gives
--    every existing company TRUE (a constant default, so no table rewrite), and
--    a company with no HR configuration row yet counts as on. An admin turns it
--    OFF in HR configuration -> Attendance rules. A web punch also needs a face
--    scan that matches the person's enrolled face (the phone's face check). JDBC
--    only: the HrConfiguration entity does NOT map it (ddl-auto=validate ignores
--    extra columns, and JPA updates of the row never touch it). While it is off,
--    or while this column is missing, the punch API refuses the WEB method
--    (WEB_PUNCH_NOT_ALLOWED).
-- 2. WEB added to the two method CHECKs on attendance.records
--    (ck_attendance_records_check_in_method / _check_out_method). The Java enum
--    CheckInMethod gains WEB; that is not a mapping change (the column stays
--    VARCHAR). WEB rows appear once people punch from the browser.
--
--    attendance.records is PARTITIONED (monthly partitions plus a default one,
--    all inheriting these CHECKs). Swapping a CHECK the plain way (DROP, then
--    ADD) scans every partition while holding an ACCESS EXCLUSIVE lock. So each
--    CHECK is swapped in four idempotent steps, each its own statement:
--      a. ADD a new CHECK (with WEB) under a temporary name, NOT VALID
--         (brief ACCESS EXCLUSIVE lock, no scan);
--      b. VALIDATE it (scans the partitions under SHARE UPDATE EXCLUSIVE, which
--         lets reads and writes carry on);
--      c. DROP the old CHECK, only once the new one exists and is validated
--         (brief lock);
--      d. RENAME the new CHECK to the old name (brief lock).
--    Every step checks the catalog first, so the file can be re-run, or resumed
--    after a stop, at any point.
--    PRODUCTION: run this file with psql in autocommit mode (NOT with
--    --single-transaction, and not inside BEGIN/COMMIT), so each statement
--    commits on its own and step b does not run under step a's lock. Flyway
--    (local and test databases) wraps the file in one transaction, which is
--    fine for their size.
-- 3. hrms.employee_punch_rules — "Anywhere (no geofence)" per person. When
--    allow_anywhere is set, check-in skips the geofence check for that person
--    (self punch, the pre-punch zone check, and assisted face punch). No row,
--    or no table, means the rule is off: today's behaviour. JDBC only.
--
-- No new permission. Numbered 143.53 (the redesign's range). Idempotent.
-- Production has Flyway OFF: apply by hand, as a superuser (row-level security).

-- ── 1. the company switch ────────────────────────────────────────────────────
ALTER TABLE settings.hr_configuration
    ADD COLUMN IF NOT EXISTS allow_web_punch BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN settings.hr_configuration.allow_web_punch IS
    'Allow web check-in (V143.53): people may check in and out from the browser, with the browser''s location and a face scan. On by default; an admin can turn it off. JDBC only; the HrConfiguration entity does not map it.';

-- ── 2. WEB in the method CHECKs (see the header for why four steps) ─────────
-- 2a. the new CHECKs, NOT VALID, under temporary names
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'attendance.records'::regclass
                      AND conname = 'ck_attendance_records_check_in_method'
                      AND pg_get_constraintdef(oid) LIKE '%''WEB''%')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'attendance.records'::regclass
                          AND conname = 'ck_attendance_records_check_in_method_web') THEN
        ALTER TABLE attendance.records
            ADD CONSTRAINT ck_attendance_records_check_in_method_web CHECK (check_in_method IS NULL OR check_in_method::text = ANY (ARRAY[
                'MANUAL', 'FACE_RECOGNITION', 'BIOMETRIC_FINGERPRINT', 'MOBILE_GPS', 'KIOSK', 'GEO_FENCE',
                'API', 'GPS', 'PIN', 'MANAGER_OVERRIDE', 'BIOMETRIC_DEVICE', 'WEB'])) NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'attendance.records'::regclass
                      AND conname = 'ck_attendance_records_check_out_method'
                      AND pg_get_constraintdef(oid) LIKE '%''WEB''%')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'attendance.records'::regclass
                          AND conname = 'ck_attendance_records_check_out_method_web') THEN
        ALTER TABLE attendance.records
            ADD CONSTRAINT ck_attendance_records_check_out_method_web CHECK (check_out_method IS NULL OR check_out_method::text = ANY (ARRAY[
                'MANUAL', 'FACE_RECOGNITION', 'BIOMETRIC_FINGERPRINT', 'MOBILE_GPS', 'KIOSK', 'GEO_FENCE',
                'API', 'GPS', 'PIN', 'MANAGER_OVERRIDE', 'BIOMETRIC_DEVICE', 'WEB'])) NOT VALID;
    END IF;
END $$;

-- 2b. validate them (reads and writes carry on meanwhile)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'attendance.records'::regclass
                  AND conname = 'ck_attendance_records_check_in_method_web' AND NOT convalidated) THEN
        ALTER TABLE attendance.records VALIDATE CONSTRAINT ck_attendance_records_check_in_method_web;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'attendance.records'::regclass
                  AND conname = 'ck_attendance_records_check_out_method_web' AND NOT convalidated) THEN
        ALTER TABLE attendance.records VALIDATE CONSTRAINT ck_attendance_records_check_out_method_web;
    END IF;
END $$;

-- 2c. drop the old CHECKs, only once the new ones exist and are validated
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'attendance.records'::regclass
                  AND conname = 'ck_attendance_records_check_in_method_web' AND convalidated)
       AND EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'attendance.records'::regclass
                      AND conname = 'ck_attendance_records_check_in_method') THEN
        ALTER TABLE attendance.records DROP CONSTRAINT ck_attendance_records_check_in_method;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'attendance.records'::regclass
                  AND conname = 'ck_attendance_records_check_out_method_web' AND convalidated)
       AND EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'attendance.records'::regclass
                      AND conname = 'ck_attendance_records_check_out_method') THEN
        ALTER TABLE attendance.records DROP CONSTRAINT ck_attendance_records_check_out_method;
    END IF;
END $$;

-- 2d. the new CHECKs take the old names
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'attendance.records'::regclass
                  AND conname = 'ck_attendance_records_check_in_method_web' AND convalidated)
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'attendance.records'::regclass
                          AND conname = 'ck_attendance_records_check_in_method') THEN
        ALTER TABLE attendance.records
            RENAME CONSTRAINT ck_attendance_records_check_in_method_web TO ck_attendance_records_check_in_method;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'attendance.records'::regclass
                  AND conname = 'ck_attendance_records_check_out_method_web' AND convalidated)
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'attendance.records'::regclass
                          AND conname = 'ck_attendance_records_check_out_method') THEN
        ALTER TABLE attendance.records
            RENAME CONSTRAINT ck_attendance_records_check_out_method_web TO ck_attendance_records_check_out_method;
    END IF;
END $$;

-- ── 3. "Anywhere (no geofence)" per person ───────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.employee_punch_rules (
    tenant_id          UUID          NOT NULL,
    employee_id        UUID          NOT NULL,
    allow_anywhere     BOOLEAN       NOT NULL DEFAULT FALSE,
    updated_by_user_id UUID,
    updated_by_name    VARCHAR(200),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_employee_punch_rules PRIMARY KEY (tenant_id, employee_id)
);

COMMENT ON TABLE hrms.employee_punch_rules IS
    'Per-person punch rules (V143.53). allow_anywhere: this person may check in from anywhere (no geofence). No row = the company rules apply, as before. JDBC only.';

ALTER TABLE hrms.employee_punch_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_punch_rules FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'employee_punch_rules'
                      AND policyname = 'tenant_isolation_employee_punch_rules') THEN
        CREATE POLICY tenant_isolation_employee_punch_rules ON hrms.employee_punch_rules
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 4. grants for the runtime role ───────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.employee_punch_rules TO ut_app;
    ELSE
        RAISE NOTICE 'V143.53: role ut_app not present — grants skipped';
    END IF;
END $$;
