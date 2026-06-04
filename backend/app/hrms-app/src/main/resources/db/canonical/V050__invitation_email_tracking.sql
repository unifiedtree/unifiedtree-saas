-- ============================================================================
-- V050 - Invitation email send tracking
-- ----------------------------------------------------------------------------
-- The invitation/reset email is now sent ASYNCHRONOUSLY (best-effort) so a slow
-- or unreachable SMTP server never blocks the HTTP request that created the
-- token. These columns record the delivery outcome so the UI can show
-- "queued / sent / failed" and offer a retry.
--
--   send_status        PENDING  → token created, email queued (not yet attempted)
--                      SENT     → mailService.send() succeeded
--                      FAILED   → mailService.send() threw (see last_send_error)
--   send_attempted_at  when the async send last ran (SENT or FAILED)
--   last_send_error    truncated exception message on the most recent failure
-- ============================================================================

ALTER TABLE auth.invitation_tokens
    ADD COLUMN IF NOT EXISTS send_status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS send_attempted_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_send_error    TEXT;

-- Constraint added separately so the IF NOT EXISTS column adds stay idempotent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
         WHERE table_schema = 'auth' AND table_name = 'invitation_tokens'
           AND constraint_name = 'chk_invitation_send_status'
    ) THEN
        ALTER TABLE auth.invitation_tokens
            ADD CONSTRAINT chk_invitation_send_status
            CHECK (send_status IN ('PENDING','SENT','FAILED'));
    END IF;
END $$;

-- Partial index to quickly find invites that still need attention (queued or failed).
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_send_status
    ON auth.invitation_tokens (send_status)
    WHERE send_status IN ('PENDING','FAILED');

-- Verification
DO $$
DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'invitation_tokens'
       AND column_name = 'send_status';
    RAISE NOTICE 'auth.invitation_tokens.send_status present: %', (c = 1);
END $$;
