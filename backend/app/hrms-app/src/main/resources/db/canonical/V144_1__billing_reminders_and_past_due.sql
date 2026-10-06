-- ============================================================================
-- V144_1 - Payment reminders and grace counted from the due date
-- ============================================================================
-- Owner rules (6 Oct 2026): reminders start 3 days before each due date and
-- repeat every day until paid; grace is 7 days after the due date.
--
-- 1. platform.subscriptions.past_due_since — when the charge that failed was
--    due. Set on the first failed charge (Razorpay "pending"/"halted"), kept
--    while Razorpay retries, cleared when a charge succeeds. Grace ends at
--    past_due_since + 7 days. (next_charge_at can't serve: Razorpay moves it
--    to the retry date.)
-- 2. platform.billing_reminders_sent — one row per subscription per day, the
--    race-safe claim (INSERT … ON CONFLICT DO NOTHING) that keeps the daily
--    reminder job to one message a day even with several backend instances.
--
-- Flyway is OFF in production: apply by hand, as the table owner, BEFORE or
-- AFTER the backend deploy — the code checks that both exist and simply skips
-- this work until they do. Idempotent.
--
-- Rollback (safe): DROP TABLE platform.billing_reminders_sent;
--                  ALTER TABLE platform.subscriptions DROP COLUMN past_due_since;
-- ============================================================================

ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;

COMMENT ON COLUMN platform.subscriptions.past_due_since IS
    'When the charge that failed was due; grace ends 7 days later. NULL while payments are on time.';

CREATE TABLE IF NOT EXISTS platform.billing_reminders_sent (
    subscription_id UUID        NOT NULL REFERENCES platform.subscriptions(id) ON DELETE CASCADE,
    sent_on         DATE        NOT NULL,           -- the IST day the reminder went out
    tenant_id       UUID        NOT NULL,
    kind            VARCHAR(20) NOT NULL CHECK (kind IN ('DUE_SOON', 'OVERDUE')),
    due_on          DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subscription_id, sent_on)
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, DELETE ON platform.billing_reminders_sent TO ut_app;
    ELSE
        RAISE NOTICE 'V144.1: role ut_app not present — grants skipped';
    END IF;
END $$;
