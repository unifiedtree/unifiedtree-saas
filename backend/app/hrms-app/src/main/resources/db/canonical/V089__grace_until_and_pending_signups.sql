-- ============================================================================
-- V089 - Backfill columns + tables that shipped to prod via psycopg but never
--        made it into the Flyway canonical stream, so Testcontainers-backed
--        integration tests (which run Flyway from V001) blow up with
--        `column "grace_until" does not exist` when SubscriptionStateReconciler
--        starts.
--
-- Everything here mirrors `scripts/add_unified_signup_columns.py` EXACTLY —
-- adds identical columns, indexes, and the pending_signups table. Idempotent
-- (IF NOT EXISTS everywhere) so a re-run against prod is a no-op if the
-- psycopg script already applied.
-- ============================================================================

-- ── platform.subscriptions: extended status + grace_until + pending_signup_id
ALTER TABLE platform.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE platform.subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN (
        'PENDING_MANDATE','TRIALING','ACTIVE','PAST_DUE',
        'HALTED','GRACE','COMPLETED','CANCELLED','PAUSED','EXPIRED'
    ));

ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS grace_until       TIMESTAMPTZ;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS pending_signup_id UUID;

-- Ensure the razorpay-subscription-id index only enforces uniqueness on
-- non-null values (was a plain UNIQUE before, which forbade NULLs on
-- pending rows).
DROP INDEX IF EXISTS platform.ix_subscriptions_razorpay_subscription_id;
CREATE UNIQUE INDEX IF NOT EXISTS ux_subscriptions_razorpay_subscription_id
    ON platform.subscriptions(razorpay_subscription_id)
    WHERE razorpay_subscription_id IS NOT NULL;

-- ── platform.tenants: KYC/company detail columns mirrored from pending_signup
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS pan            VARCHAR(20);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS gstin          VARCHAR(20);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS address_line1  VARCHAR(255);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS address_line2  VARCHAR(255);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS city           VARCHAR(100);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS state          VARCHAR(100);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS postal_code    VARCHAR(20);

-- ── platform.razorpay_webhook_events: async processor status tracking
ALTER TABLE platform.razorpay_webhook_events ADD COLUMN IF NOT EXISTS processed_at   TIMESTAMPTZ;
ALTER TABLE platform.razorpay_webhook_events ADD COLUMN IF NOT EXISTS process_status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED';
ALTER TABLE platform.razorpay_webhook_events ADD COLUMN IF NOT EXISTS process_error  TEXT;
CREATE INDEX IF NOT EXISTS ix_razorpay_webhook_events_status
    ON platform.razorpay_webhook_events(process_status)
    WHERE process_status <> 'DONE';

-- ── platform.pending_signups: paid-plan signup rows awaiting mandate approval
CREATE TABLE IF NOT EXISTS platform.pending_signups (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode                     VARCHAR(16) NOT NULL CHECK (mode IN ('TRIAL','PAID')),
    account_id               UUID,
    email                    VARCHAR(255) NOT NULL,
    password_hash            VARCHAR(255),
    phone                    VARCHAR(20),
    admin_name               VARCHAR(150) NOT NULL,
    company_name             VARCHAR(150) NOT NULL,
    subdomain                VARCHAR(63)  NOT NULL,
    country                  VARCHAR(50),
    timezone                 VARCHAR(50),
    currency                 VARCHAR(10) DEFAULT 'INR',
    language                 VARCHAR(20),
    primary_interest         VARCHAR(100),
    plan_keys                TEXT[] NOT NULL,
    seats                    INT    NOT NULL DEFAULT 1,
    billing_cycle            VARCHAR(16) NOT NULL DEFAULT 'monthly'
                                CHECK (billing_cycle IN ('monthly','yearly')),
    pan                      VARCHAR(20),
    gstin                    VARCHAR(20),
    address_line1            VARCHAR(255),
    address_line2            VARCHAR(255),
    city                     VARCHAR(100),
    state                    VARCHAR(100),
    postal_code              VARCHAR(20),
    razorpay_subscription_id VARCHAR(64) NOT NULL UNIQUE,
    razorpay_customer_id     VARCHAR(64),
    razorpay_short_url       TEXT,
    status                   VARCHAR(24) NOT NULL DEFAULT 'AWAITING_MANDATE'
                                CHECK (status IN ('AWAITING_MANDATE','PROVISIONED','FAILED','EXPIRED','CANCELLED')),
    tenant_id                UUID,
    provisioned_at           TIMESTAMPTZ,
    failed_at                TIMESTAMPTZ,
    failure_reason           TEXT,
    expires_at               TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_signups_subdomain_active
    ON platform.pending_signups(lower(subdomain))
    WHERE status = 'AWAITING_MANDATE';

CREATE INDEX IF NOT EXISTS ix_pending_signups_status
    ON platform.pending_signups(status)
    WHERE status = 'AWAITING_MANDATE';

-- Grant to the runtime role if it exists (matches the psycopg pattern).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pending_signups TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pending_signups TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pending_signups TO app_user;
    END IF;
END $$;
