-- ============================================================================
-- V144_4 - Extra users billed at the end of each cycle
-- ============================================================================
-- Owner (7 Oct 2026): at the end of each billing cycle, take the highest number
-- of active employees on any day of the cycle, minus the seats bought (never
-- below 0); each extra user costs the full-month per-user price; it is added to
-- the next autopay charge (a Razorpay subscription add-on) and shown on
-- "Billing by company" with the companies the extras came from. The owner is
-- told 3 days before.
--
-- 1. platform.seat_usage_daily — the business's active employees per company per
--    day (IST), the highest seen that day (ExtraUsersJob takes a reading every
--    30 minutes). The peak of a cycle is read from here.
-- 2. platform.extra_user_charges — one row per subscription per cycle: the
--    notice, the final count and the Razorpay add-on. Its primary key is what
--    stops a cycle being charged twice.
--
-- Flyway is OFF in production: apply by hand as the owner. Idempotent. Until it
-- is applied ExtraUsersJob does nothing.
-- Rollback: DROP TABLE platform.extra_user_charges; DROP TABLE platform.seat_usage_daily;
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform.seat_usage_daily (
    tenant_id   UUID        NOT NULL,
    day         DATE        NOT NULL,
    company_id  UUID        NOT NULL,
    active      INT         NOT NULL CHECK (active >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, day, company_id)
);

CREATE TABLE IF NOT EXISTS platform.extra_user_charges (
    subscription_id   UUID          NOT NULL REFERENCES platform.subscriptions(id) ON DELETE CASCADE,
    cycle_end         DATE          NOT NULL,          -- the charge date (IST) the extras go on
    tenant_id         UUID          NOT NULL,
    seats_bought      INT           NOT NULL,
    peak_active       INT           NOT NULL,
    peak_day          DATE,
    extra_users       INT           NOT NULL CHECK (extra_users >= 0),
    unit_price_inr    NUMERIC(12,2) NOT NULL,
    amount_inr        NUMERIC(12,2) NOT NULL,
    by_company        JSONB         NOT NULL DEFAULT '[]',   -- [{companyId, name, active, extra}]
    status            VARCHAR(16)   NOT NULL CHECK (status IN ('NOTIFIED', 'NONE', 'ADDING', 'ADDED', 'FAILED')),
    razorpay_addon_id VARCHAR(64),
    error             TEXT,
    notified_at       TIMESTAMPTZ,
    added_at          TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (subscription_id, cycle_end)
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.seat_usage_daily TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.extra_user_charges TO ut_app;
    ELSE
        RAISE NOTICE 'V144.4: role ut_app not present — grants skipped';
    END IF;
END $$;
