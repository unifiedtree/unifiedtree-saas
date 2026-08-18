-- ============================================================================
-- V104__otp_requests.sql
--
-- Server-side one-time-password requests for the MSG91 phone-auth login
-- flow. Replaces the Firebase-owned OTP path with a UnifiedTree-owned code
-- lifecycle so the OTP value, hashing key, expiry and attempt counters
-- all live in our DB and cannot be side-stepped by a stale Firebase
-- sessionInfo.
--
-- Schema is `auth` (same schema as user_credentials + refresh_tokens) —
-- NOT tenant-scoped: the phone→tenant mapping is not known at /request
-- time; PhoneLookupService resolves it at /verify time using the same
-- cross-tenant scan the /v1/auth/firebase-verify path already uses.
--
-- Not tenant-scoped ⇒ RLS is intentionally NOT enabled on this table:
-- - the primary key is a UUID request id issued to a single anonymous
--   caller, so there is no cross-tenant read hazard
-- - the mobile app never queries this table directly; only the OTP
--   controllers read/write it via JdbcTemplate/JPA on the app connection
-- - a tenant_id column would be a lie until /verify anyway
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth.otp_requests (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    -- VARCHAR(10), NOT CHAR(10). Postgres maps CHAR(n) to `bpchar`, while the
    -- JPA entity maps this field as String -> Hibernate expects `varchar`.
    -- With hibernate.hbm2ddl.auto=validate that mismatch aborts EntityManager
    -- construction and the whole application fails to boot. The original
    -- CHAR(10) here bricked every backend deploy from 2026-08-17 13:23 until
    -- it was caught on 2026-08-18 (Cloud Run kept serving the last healthy
    -- revision, so there was no customer-visible outage, but no backend change
    -- could ship). Do not "tidy" this back to CHAR.
    phone_last10      VARCHAR(10)  NOT NULL,
    phone_e164        VARCHAR(16)  NOT NULL,
    otp_hash          TEXT         NOT NULL,
    purpose           VARCHAR(32)  NOT NULL DEFAULT 'LOGIN',
    provider          VARCHAR(16)  NOT NULL DEFAULT 'msg91',
    msg91_request_id  TEXT,
    correlation_id    UUID         NOT NULL DEFAULT gen_random_uuid(),
    expires_at        TIMESTAMPTZ  NOT NULL,
    sent_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    verified_at       TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,
    attempts          INT          NOT NULL DEFAULT 0,
    max_attempts      INT          NOT NULL DEFAULT 5,
    status            VARCHAR(20)  NOT NULL DEFAULT 'SENT',
    request_ip        VARCHAR(64),
    user_agent        VARCHAR(512),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_otp_requests_phone_digits
        CHECK (phone_last10 ~ '^[0-9]{10}$'),
    CONSTRAINT ck_otp_requests_status
        CHECK (status IN ('SENT','VERIFIED','EXPIRED','REVOKED','LOCKED')),
    CONSTRAINT ck_otp_requests_purpose
        CHECK (purpose IN ('LOGIN','REGISTER','PASSWORD_RESET')),
    CONSTRAINT ck_otp_requests_attempts_nonneg
        CHECK (attempts >= 0)
);

COMMENT ON TABLE auth.otp_requests IS
    'Server-owned OTP requests for MSG91 phone-auth login. Not tenant-scoped '
    'because the phone→tenant mapping is unknown at /request time; resolved '
    'at /verify time by PhoneLookupService.';

COMMENT ON COLUMN auth.otp_requests.otp_hash IS
    'BCrypt hash of the 6-digit OTP. Never stores the plaintext; verify is a '
    'constant-time BCrypt.matches() call.';

COMMENT ON COLUMN auth.otp_requests.msg91_request_id IS
    'The request_id MSG91 returns from POST /api/v5/otp. Captured for '
    'debugging + resend endpoint (/otp/retry) support.';

-- Primary lookup for per-phone rate limits (3/5min, 10/hour, 30/day) —
-- COUNT recent rows by (phone_last10, sent_at DESC).
CREATE INDEX IF NOT EXISTS ix_otp_requests_phone_sent
    ON auth.otp_requests (phone_last10, sent_at DESC);

-- Active-request lookup: find the current SENT row for a phone. Partial
-- so it stays tiny — the vast majority of rows age into VERIFIED /
-- EXPIRED / REVOKED within 10 minutes and drop out.
CREATE INDEX IF NOT EXISTS ix_otp_requests_active_phone
    ON auth.otp_requests (phone_last10)
    WHERE status = 'SENT';

-- Housekeeping / expiry sweep: cheap-to-scan slice of unverified rows
-- past their expires_at.
CREATE INDEX IF NOT EXISTS ix_otp_requests_status_expires
    ON auth.otp_requests (status, expires_at)
    WHERE status = 'SENT';

-- Correlation id joins to future audit-log tables and log lines.
CREATE INDEX IF NOT EXISTS ix_otp_requests_correlation
    ON auth.otp_requests (correlation_id);
