-- ============================================================================
-- V087 - Billing cycle (monthly/annual) end-to-end + subscriptions ledger.
-- ============================================================================
-- Annual billing was display-only: the calculator showed a 10% discount but
-- create-order always charged the monthly amount. This migration makes the
-- cycle a real, stored, server-authoritative concept:
--   * module_plans.annual_discount_pct - per-plan annual discount (DB-driven,
--     never hardcoded in the app). Default 10%.
--   * payments gains billing_cycle / period_months / unit_price_inr so the
--     ledger records exactly what was charged and for how long.
--   * platform.subscriptions - one row per activated workspace purchase, with
--     the current billing period start/end so renewal/expiry is knowable.
-- No RLS on platform.* ; ut_app just needs table DML (granted at the bottom).
-- ============================================================================

-- 1. Per-plan annual discount (percent off the monthly per-user price when
--    billed annually). DB-driven so pricing never lives in the frontend.
ALTER TABLE platform.module_plans
    ADD COLUMN IF NOT EXISTS annual_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 10.00
        CHECK (annual_discount_pct >= 0 AND annual_discount_pct <= 100);

COMMENT ON COLUMN platform.module_plans.annual_discount_pct IS
    'Percent discount off the monthly per-user price when billed annually '
    '(e.g. 10.00 => 39/user/mo becomes 35/user/mo, billed x12).';

-- 2. Record the cycle on every checkout.
ALTER TABLE platform.payments
    ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(10) NOT NULL DEFAULT 'MONTHLY'
        CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL'));
ALTER TABLE platform.payments
    ADD COLUMN IF NOT EXISTS period_months INT NOT NULL DEFAULT 1;
ALTER TABLE platform.payments
    ADD COLUMN IF NOT EXISTS unit_price_inr NUMERIC(12,2);   -- effective per-user/month rate

COMMENT ON COLUMN platform.payments.billing_cycle  IS 'MONTHLY or ANNUAL (drives period_months and the discounted unit price).';
COMMENT ON COLUMN platform.payments.period_months  IS 'Months covered by amount_inr: 1 for monthly, 12 for annual.';
COMMENT ON COLUMN platform.payments.unit_price_inr IS 'Effective per-user/month price after any annual discount (informational).';

-- 3. Subscriptions: the durable record of what a workspace is paying for and
--    until when. Created when a paid order is consumed into a workspace.
CREATE TABLE IF NOT EXISTS platform.subscriptions (
    id                    UUID           PRIMARY KEY,
    tenant_id             UUID,                                  -- the created workspace
    subdomain             VARCHAR(63),
    contact_email         VARCHAR(255),
    plan_keys             TEXT[]         NOT NULL,               -- module_plans.key[] purchased
    modules               TEXT[]         NOT NULL DEFAULT '{}',  -- functional module_catalog keys activated
    seats                 INT            NOT NULL DEFAULT 1,
    billing_cycle         VARCHAR(10)    NOT NULL DEFAULT 'MONTHLY'
                            CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
    unit_price_inr        NUMERIC(12,2)  NOT NULL DEFAULT 0,     -- per-user/month effective
    amount_inr            NUMERIC(12,2)  NOT NULL DEFAULT 0,     -- total paid for the current period
    currency              VARCHAR(10)    NOT NULL DEFAULT 'INR',
    status                VARCHAR(20)    NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED')),
    current_period_start  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    current_period_end    TIMESTAMPTZ    NOT NULL,
    razorpay_order_id     VARCHAR(64),
    razorpay_payment_id   VARCHAR(64),
    payment_id            UUID,                                  -- platform.payments.id it was created from
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant     ON platform.subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subdomain  ON platform.subscriptions(subdomain);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status     ON platform.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON platform.subscriptions(current_period_end);

COMMENT ON TABLE platform.subscriptions IS
    'Durable per-workspace subscription: which plans/seats a tenant bought, the '
    'billing cycle, and the current period window (renewal/expiry knowable). '
    'Created when a paid Razorpay order is consumed into a workspace.';

-- 4. Grants (ut_app is NOSUPERUSER/NOBYPASSRLS; platform.* is not RLS-guarded).
--    Guarded so the migration also runs where no ut_app role exists
--    (integration-test containers, fresh local dev DB). Same pattern as V084.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.subscriptions TO ut_app;
    END IF;
END $$;
