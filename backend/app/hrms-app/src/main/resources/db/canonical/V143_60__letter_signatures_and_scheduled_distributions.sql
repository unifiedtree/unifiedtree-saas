-- V143.60: letter e-signature (click to accept) and scheduled letter
-- distributions ("Send on") (HRMS redesign, package P-DOCS: BW-73, BW-76).
--
-- 1. letters.letter_signatures: HR asking an employee to sign a letter, and
--    the employee signing it. One row per letter: when and by whom it was
--    asked, when the employee was told, and the signature itself (the time,
--    the name they typed, their IP address and browser). Signing also sets the
--    letter's own status to SIGNED and its signed_at, columns letters.generated
--    already has (the GeneratedLetter entity maps them), so no entity changes.
--    It is a click-to-accept record, not a certified e-signature, and nothing
--    is stamped on the PDF.
-- 2. letters.distribution_schedules: a distribution set up now and sent on a
--    later date. It keeps what "Send now" would send (template, title, message,
--    subject, the recipient filter) and the date. A job starts it as an
--    ordinary distribution from 09:00 India time on that date (status STARTED,
--    with the distribution's id). Cancel deletes the row. One that could not
--    start (for example no one matches any more) is kept as FAILED with the
--    reason.
--
-- Both tables are read and written with JDBC only (no JPA entity maps them).
-- Until this file is applied the app answers FEATURE_NOT_READY for asking,
-- signing and scheduling, and leaves the new fields empty; generating,
-- sending and "Send now" work as before. No new permissions: signing uses
-- hrms.letters.read.self, scheduling hrms.letters.distribute, both existing.
--
-- Numbered 143.60 (assigned slot). Idempotent. Production has Flyway OFF:
-- apply by hand, as a superuser.

-- ── 1. letter signatures ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS letters.letter_signatures (
    tenant_id           UUID          NOT NULL,
    letter_id           UUID          NOT NULL REFERENCES letters.generated(id) ON DELETE CASCADE,
    employee_id         UUID          NOT NULL,
    requested_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    requested_by        UUID,
    requested_by_name   VARCHAR(200),
    notified_at         TIMESTAMPTZ,
    signed_at           TIMESTAMPTZ,
    signed_name         VARCHAR(200),
    signed_ip           VARCHAR(64),
    signed_user_agent   VARCHAR(500),
    PRIMARY KEY (tenant_id, letter_id),
    CONSTRAINT ck_letter_signatures_signed CHECK ((signed_at IS NULL) = (signed_name IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_letter_signatures_letter
    ON letters.letter_signatures (letter_id);
CREATE INDEX IF NOT EXISTS idx_letter_signatures_employee_open
    ON letters.letter_signatures (tenant_id, employee_id) WHERE signed_at IS NULL;

COMMENT ON TABLE letters.letter_signatures IS
    'HR asking an employee to sign a letter, and the click-to-accept signature: time, typed name, IP, browser (V143.60). Signing also sets letters.generated.status = SIGNED and signed_at.';

ALTER TABLE letters.letter_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE letters.letter_signatures FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'letters' AND tablename = 'letter_signatures'
                      AND policyname = 'tenant_isolation_letter_signatures') THEN
        CREATE POLICY tenant_isolation_letter_signatures ON letters.letter_signatures
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. scheduled distributions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS letters.distribution_schedules (
    id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID          NOT NULL,
    template_id              UUID          NOT NULL REFERENCES letters.templates(id),
    title                    VARCHAR(200)  NOT NULL,
    custom_message           TEXT,
    subject_override         VARCHAR(500),
    recipient_filter         JSONB         NOT NULL,
    send_on                  DATE          NOT NULL,
    status                   VARCHAR(10)   NOT NULL DEFAULT 'SCHEDULED',
    recipients_at_schedule   INT,
    job_id                   UUID          REFERENCES letters.distribution_jobs(id) ON DELETE SET NULL,
    failure_reason           VARCHAR(500),
    created_by               UUID          NOT NULL,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    started_at               TIMESTAMPTZ,
    CONSTRAINT ck_distribution_schedules_status CHECK (status IN ('SCHEDULED', 'STARTING', 'STARTED', 'FAILED'))
);
CREATE INDEX IF NOT EXISTS idx_distribution_schedules_due
    ON letters.distribution_schedules (tenant_id, status, send_on);

COMMENT ON TABLE letters.distribution_schedules IS
    'Letter distributions set up to send on a later date (V143.60). Started as an ordinary distribution from 09:00 India time on send_on; cancelling deletes the row.';

ALTER TABLE letters.distribution_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE letters.distribution_schedules FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'letters' AND tablename = 'distribution_schedules'
                      AND policyname = 'tenant_isolation_distribution_schedules') THEN
        CREATE POLICY tenant_isolation_distribution_schedules ON letters.distribution_schedules
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. grants for the runtime role ──────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA letters TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.letter_signatures TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.distribution_schedules TO ut_app;
    ELSE
        RAISE NOTICE 'V143.60: role ut_app not present — grants skipped';
    END IF;
END $$;
