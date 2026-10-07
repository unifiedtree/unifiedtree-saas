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
--    30 minutes). The peak of a cycle is read from here. Readings older than
--    400 days are deleted by the job.
-- 2. platform.extra_user_charges — one row per business per cycle: the notice,
--    the final count and the Razorpay add-on. A billing record: never deleted
--    by the app, and its subscription can't be deleted while it exists. Two keys
--    stop a cycle being charged twice: (subscription_id, cycle_end) and
--    (tenant_id, cycle_end) — one extra-users charge per business per cycle.
--    status: NOTIFIED (told, not yet charged) / NONE (no extras) / ADDING (being
--    added right now) / ADDED / FAILED (refused, retried until the charge) /
--    UNKNOWN (Razorpay's answer never came: NOT retried, check Razorpay) /
--    MISSED (the charge passed without the extras).
--
-- No tenant foreign key, like platform.subscriptions, which these rows follow
-- (subscription_id is RESTRICT); a business is never deleted, it is closed.
--
-- ── Applying by hand (Flyway is OFF in production) ─────────────────────────────
-- After V144_101 → 107 (PR #12). Depends only on platform.subscriptions. Deploy
-- the code first: ExtraUsersJob and "Billing by company" do nothing with this
-- until both tables exist. Then, as the owner role, one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f V144_4__extra_users_at_cycle_end.sql
-- lock_timeout = 5s: a lock it cannot get fails the file (nothing applied)
-- instead of queueing requests behind it. Re-run it when traffic is lower.
-- Idempotent.
-- Rollback (only while no row is ADDED or UNKNOWN — those are real charges):
--     DROP TABLE platform.extra_user_charges; DROP TABLE platform.seat_usage_daily;
-- ============================================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.seat_usage_daily (
    tenant_id   UUID        NOT NULL,
    day         DATE        NOT NULL,
    company_id  UUID        NOT NULL,
    active      INT         NOT NULL CHECK (active >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, day, company_id)
);

CREATE TABLE IF NOT EXISTS platform.extra_user_charges (
    subscription_id   UUID          NOT NULL REFERENCES platform.subscriptions(id) ON DELETE RESTRICT,
    cycle_end         DATE          NOT NULL,          -- the cycle's last day + 1 (IST): the charge the extras go on
    tenant_id         UUID          NOT NULL,
    seats_bought      INT           NOT NULL,
    peak_active       INT           NOT NULL,
    peak_day          DATE,
    extra_users       INT           NOT NULL CHECK (extra_users >= 0),
    unit_price_inr    NUMERIC(12,2) NOT NULL,
    amount_inr        NUMERIC(12,2) NOT NULL,
    by_company        JSONB         NOT NULL DEFAULT '[]',   -- [{companyId, name, active, extra}]
    status            VARCHAR(16)   NOT NULL
                      CHECK (status IN ('NOTIFIED', 'NONE', 'ADDING', 'ADDED', 'FAILED', 'UNKNOWN', 'MISSED')),
    razorpay_addon_id VARCHAR(64),
    error             TEXT,
    notified_at       TIMESTAMPTZ,
    added_at          TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (subscription_id, cycle_end),
    CONSTRAINT uq_extra_user_charges_business_cycle UNIQUE (tenant_id, cycle_end)
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.seat_usage_daily TO ut_app;
        GRANT SELECT, INSERT, UPDATE ON platform.extra_user_charges TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA platform TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.seat_usage_daily TO hrms_app;
        GRANT SELECT, INSERT, UPDATE ON platform.extra_user_charges TO hrms_app;
    END IF;
END $$;

-- Charges are billing records: never deleted by the app. Explicit, because V089's ALTER DEFAULT
-- PRIVILEGES (where its owner role ran it) hands DELETE on every new platform table to the app roles;
-- production has no default privileges, so this makes both the same (as PR #12, f1220e79).
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app', 'app_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE DELETE ON platform.extra_user_charges FROM %I', r);
        END IF;
    END LOOP;
END $$;
