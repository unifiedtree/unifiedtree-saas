-- ============================================================================
-- V106__otp_phone_last10_varchar.sql
--
-- Repair auth.otp_requests.phone_last10 from CHAR(10) to VARCHAR(10).
--
-- WHY THIS EXISTS
-- ---------------
-- V104 created the column as CHAR(10). Postgres reports CHAR(n) as `bpchar`,
-- but the OtpRequest JPA entity maps the field as String, so Hibernate expects
-- `varchar`. Because the app runs with schema validation enabled, that single
-- type mismatch aborted EntityManagerFactory construction:
--
--   SchemaManagementException: wrong column type encountered in column
--   [phone_last10] in table [auth.otp_requests]; found [bpchar (Types#CHAR)],
--   but expecting [varchar(10) (Types#VARCHAR)]
--
-- The container then exited(1) before binding :8080, so Cloud Run marked every
-- new revision HealthCheckContainerError and kept serving the previous healthy
-- revision. No customer-visible outage — but every backend deploy from
-- 2026-08-17 13:23 onwards silently failed to take effect.
--
-- CHAR(10) was also wrong on its own merits: it blank-pads to a fixed width, so
-- any value shorter than 10 characters would compare unequal to the unpadded
-- string the application sends.
--
-- SAFETY
-- ------
-- The table is ephemeral OTP state (rows expire within 10 minutes) and was
-- empty when this ran, so the rewrite is instant. The USING clause trims the
-- blank padding CHAR would have introduced, which is a no-op on unpadded data
-- but makes the migration correct even if rows exist.
--
-- Idempotent: guarded on the current data type, so re-running is a no-op.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'auth'
           AND table_name   = 'otp_requests'
           AND column_name  = 'phone_last10'
           AND data_type    = 'character'      -- i.e. CHAR/bpchar
    ) THEN
        ALTER TABLE auth.otp_requests
            ALTER COLUMN phone_last10 TYPE VARCHAR(10) USING btrim(phone_last10);
        RAISE NOTICE 'V106: auth.otp_requests.phone_last10 CHAR(10) -> VARCHAR(10)';
    ELSE
        RAISE NOTICE 'V106: auth.otp_requests.phone_last10 already VARCHAR - no change';
    END IF;
END $$;
