-- V144.103: plan prices are versioned.
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
-- amount_inr, so no historical charge is rewritten by a later price change. The
-- code also prices a replacement subscription (seat change on an immutable mandate)
-- at the old subscription's rate, and a ledger rate of 0 at the version in force when
-- the subscription was bought: existing customers keep the price they bought at.
--
-- Safety. Additive; the seed inserts only for plans with no version yet. History
-- is never deleted (plans are retired, not deleted: plan_key is RESTRICT).
-- Idempotent.
--
-- ── Applying by hand (Flyway is OFF in production) ─────────────────────────────
-- Order: strictly V144_101 → 102 → 103 → 104 → 105 → 106, BEFORE deploying the PR #12 revision
-- (104 needs 103: invoice_lines → module_plan_prices; 105 needs 102: company_modules.limits;
-- 106 needs 104: usage_ledger → invoice_lines; 102–106 need 102's uq_companies_id_tenant).
-- V144_107 is applied AFTER the deploy. Each file is one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f <file>
-- Each sets lock_timeout = 5s: a lock it cannot get fails the file (nothing applied) instead of queueing
-- HRMS requests behind it. Re-run it when traffic is lower.
-- This file: third (after 102). 104 needs it (invoice_lines.price_version_id).
-- Rollback: DROP TABLE platform.module_plan_prices, after 104 (full list in V144_101).

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.module_plan_prices (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_key            VARCHAR(50)   NOT NULL REFERENCES platform.module_plans(key) ON DELETE RESTRICT,
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
       'Baseline: the price in effect when price history began (V144.103)', 'migration:V144_103'
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

-- Price history is closed (valid_to), never deleted.
-- Explicit, because V089's ALTER DEFAULT PRIVILEGES (where its owner role ran it) hands DELETE on every new
-- platform table to the app roles; production has no default privileges, so this makes both the same.
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app', 'app_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE DELETE ON platform.module_plan_prices FROM %I', r);
        END IF;
    END LOOP;
END $$;

