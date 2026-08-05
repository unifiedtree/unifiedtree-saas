-- ============================================================================
-- V088 - 7-day free trial support (DB-driven; workspace stays fully usable
--        after expiry, only notifications fire).
-- ============================================================================
-- Requirements: new signups can start a trial WITHOUT paying. A daily job
-- notifies admins (in-app + email) as the trial nears end and again on
-- expiry, but does NOT disable anything. Trial length is configurable in the
-- DB so product can tune it without a deploy.
-- ============================================================================

-- 1. Distinguish TRIAL vs PAID subscriptions on the existing ledger. Existing
--    rows all came from paid Razorpay orders, so PAID is the correct backfill
--    and the safe default for future paid signups.
ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS plan_type VARCHAR(10) NOT NULL DEFAULT 'PAID'
        CHECK (plan_type IN ('TRIAL', 'PAID'));

COMMENT ON COLUMN platform.subscriptions.plan_type IS
    'TRIAL = created via /trial-signup (no payment, current_period_end = signup + trial_days). '
    'PAID = created from a verified Razorpay payment.';

-- Notification stamps so we never send the same warning/expiry twice per period.
ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS trial_warning_sent_at TIMESTAMPTZ;
ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS trial_expired_notice_sent_at TIMESTAMPTZ;

-- Partial index — the daily job scans only ACTIVE TRIAL rows, so keep the
-- index small even as PAID rows pile up.
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_trials
    ON platform.subscriptions(current_period_end)
    WHERE plan_type = 'TRIAL' AND status = 'ACTIVE';

-- 2. Global billing settings. Singleton row (id fixed to 1) — trial length
--    changes are one UPDATE, no code deploy. New knobs go in as more columns.
CREATE TABLE IF NOT EXISTS platform.billing_settings (
    id                         INT          PRIMARY KEY DEFAULT 1,
    trial_enabled              BOOLEAN      NOT NULL DEFAULT TRUE,
    trial_days                 INT          NOT NULL DEFAULT 7
                                 CHECK (trial_days > 0 AND trial_days <= 90),
    trial_warning_days_before  INT          NOT NULL DEFAULT 1
                                 CHECK (trial_warning_days_before >= 0),
    upgrade_url                VARCHAR(500) NOT NULL DEFAULT 'https://www.unifiedtree.com/pricing',
    updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT billing_settings_singleton CHECK (id = 1)
);

INSERT INTO platform.billing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE platform.billing_settings IS
    'Singleton row (id=1) holding tunable billing knobs (trial length, warning offset, '
    'upgrade URL). UPDATE to change; no deploy needed.';

-- 3. Grants (ut_app is NOSUPERUSER/NOBYPASSRLS; platform.* is not RLS-guarded).
--    Guarded so the migration also runs where no ut_app role exists
--    (integration-test containers, fresh local dev DB). Same pattern as V084.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE ON platform.billing_settings TO ut_app;
    END IF;
END $$;
