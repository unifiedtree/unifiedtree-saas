-- V144.3: plan prices are versioned.
--
-- Why. platform.module_plans holds ONE price per plan (price_inr). Changing it
-- rewrote the only record of what the plan used to cost, so "what was this
-- customer quoted in August?" had no answer except the subscription's own
-- snapshot. A price change must add history, not overwrite it.
--
-- What it does. platform.module_plan_prices keeps every price a plan has had:
-- unit price, model and annual discount, valid from/to. The open row
-- (valid_to IS NULL) is the current price. platform.module_plans.price_inr stays
-- as the current price, so every existing reader (checkout, website pricing,
-- seat billing) keeps working; the platform admin API changes both in one
-- transaction.
--
-- Seed. Each plan's current price becomes its first version, valid from the
-- plan's created_at. That is the best date available: earlier changes were
-- never recorded, which is the gap this table closes.
--
-- Unchanged: subscriptions and payments already snapshot unit_price_inr and
-- amount_inr, so no historical charge is rewritten by a later price change.
--
-- Safety. Additive; the seed inserts only for plans with no version yet.
-- Idempotent. Production has Flyway OFF: apply by hand.

CREATE TABLE IF NOT EXISTS platform.module_plan_prices (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_key            VARCHAR(50)   NOT NULL REFERENCES platform.module_plans(key) ON DELETE CASCADE,
    currency            VARCHAR(3)    NOT NULL DEFAULT 'INR',
    unit_price          NUMERIC(12,2) NOT NULL,
    price_model         VARCHAR(20)   NOT NULL,
    annual_discount_pct NUMERIC(5,2)  NOT NULL DEFAULT 0,
    valid_from          TIMESTAMPTZ   NOT NULL,
    valid_to            TIMESTAMPTZ,
    reason              TEXT,
    created_by          VARCHAR(255),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_plan_prices_unit_price CHECK (unit_price >= 0),
    CONSTRAINT ck_plan_prices_model      CHECK (price_model IN ('PER_SEAT', 'FLAT')),
    CONSTRAINT ck_plan_prices_discount   CHECK (annual_discount_pct >= 0 AND annual_discount_pct <= 100),
    CONSTRAINT ck_plan_prices_period     CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- At most one current (open-ended) price per plan and currency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_open
    ON platform.module_plan_prices (plan_key, currency) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_prices_plan_from
    ON platform.module_plan_prices (plan_key, valid_from DESC);

COMMENT ON TABLE platform.module_plan_prices IS
    'Every price a plan has had. Open row (valid_to IS NULL) = current price, mirrored in module_plans.price_inr.';

INSERT INTO platform.module_plan_prices
       (plan_key, currency, unit_price, price_model, annual_discount_pct, valid_from, reason, created_by)
SELECT p.key, 'INR', p.price_inr, p.price_model, p.annual_discount_pct, p.created_at,
       'Baseline: the price in effect when price history began (V144.3)', 'migration:V144_3'
  FROM platform.module_plans p
 WHERE NOT EXISTS (SELECT 1 FROM platform.module_plan_prices x WHERE x.plan_key = p.key);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE ON platform.module_plan_prices TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA platform TO hrms_app;
        GRANT SELECT, INSERT, UPDATE ON platform.module_plan_prices TO hrms_app;
    END IF;
END $$;
