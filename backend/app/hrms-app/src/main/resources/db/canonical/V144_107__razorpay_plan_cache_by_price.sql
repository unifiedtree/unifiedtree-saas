-- V144.107: the Razorpay plan cache is keyed by price.
--
-- APPLY AFTER the PR #12 revision is live (not with V144_101–106, which go BEFORE the deploy).
--   The revision running before PR #12 inserts with ON CONFLICT (module_key, billing_cycle), which needs
--   the old unique key this migration drops. The PR #12 code works under either key (its insert names no
--   conflict target and it looks plans up by price), so until this is applied it is correct, it just
--   cannot cache a second price for the same module and cycle.
--   psql -1 -v ON_ERROR_STOP=1 -f V144_107__razorpay_plan_cache_by_price.sql
--
-- Why. platform.razorpay_plans caches one Razorpay plan per (module_key, billing_cycle). A Razorpay plan
-- fixes its amount, so after a price change that cache either charged new checkouts the old price or, once
-- cleared, created replacement subscriptions (seat change on a UPI mandate) at the new price, which
-- re-priced existing customers. Keyed by (module_key, billing_cycle, unit_price_paise), every price has its
-- own plan and nothing has to be cleared.
--
-- Safety. Existing rows already satisfy the new key (it is a superset of the old one). Takes a brief
-- SHARE lock on razorpay_plans while the index builds (a handful of rows). Idempotent.
--
-- The old key is a UNIQUE CONSTRAINT in production (created there before V089, whose CREATE UNIQUE INDEX IF
-- NOT EXISTS then did nothing) and a plain unique index on databases built from migrations: both are handled.
--
-- Rollback (only while no two rows share a module_key + billing_cycle, and with the pre-PR #12 code back):
--   ALTER TABLE platform.razorpay_plans
--       ADD CONSTRAINT razorpay_plans_module_key_billing_cycle_key UNIQUE (module_key, billing_cycle);
--   DROP INDEX platform.uq_razorpay_plans_module_cycle_price;

SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_razorpay_plans_module_cycle_price
    ON platform.razorpay_plans (module_key, billing_cycle, unit_price_paise);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conname = 'razorpay_plans_module_key_billing_cycle_key'
                  AND conrelid = 'platform.razorpay_plans'::regclass) THEN
        ALTER TABLE platform.razorpay_plans DROP CONSTRAINT razorpay_plans_module_key_billing_cycle_key;
    END IF;
END $$;
DROP INDEX IF EXISTS platform.razorpay_plans_module_key_billing_cycle_key;
