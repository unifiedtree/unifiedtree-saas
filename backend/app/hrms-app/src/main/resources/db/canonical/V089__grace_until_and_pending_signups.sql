-- ============================================================================
-- V089 - Backports every column + table that shipped to prod via psycopg since
--        V087 but was never mirrored to Flyway. Testcontainers-backed ITs run
--        Flyway from V001, so drift here cascades: SubscriptionStateReconciler
--        SELECTs grace_until, hits "column does not exist", 500s bleed into
--        LetterFlowIT / LetterDistributionIT / RbacFlowIT / etc.
--
-- Column-by-column ADD COLUMN IF NOT EXISTS instead of CREATE TABLE — this
-- runs cleanly against BOTH a fresh CI container (adds columns that don't
-- exist) AND against prod (every column already there → no-op). Same pattern
-- as branding V088.
-- ============================================================================

-- ── platform.subscriptions: broaden status enum + add 15 columns ────────────

ALTER TABLE platform.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE platform.subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN (
        'PENDING_MANDATE','TRIALING','ACTIVE','PAST_DUE',
        'HALTED','GRACE','COMPLETED','CANCELLED','PAUSED','EXPIRED'
    ));

ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS plan_type                     VARCHAR(10);
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS trial_warning_sent_at         TIMESTAMPTZ;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS trial_expired_notice_sent_at  TIMESTAMPTZ;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS razorpay_subscription_id      VARCHAR(64);
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS razorpay_plan_id              VARCHAR(64);
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS next_charge_at                TIMESTAMPTZ;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS halted_at                     TIMESTAMPTZ;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS auto_renew                    BOOLEAN;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS payment_method                VARCHAR(32);
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS grace_until                   TIMESTAMPTZ;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS pending_signup_id             UUID;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS last_reconciled_at            TIMESTAMPTZ;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS last_razorpay_status          VARCHAR(32);
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS reconcile_error               TEXT;
ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at                 TIMESTAMPTZ;

DROP INDEX IF EXISTS platform.ix_subscriptions_razorpay_subscription_id;
CREATE UNIQUE INDEX IF NOT EXISTS ux_subscriptions_razorpay_subscription_id
    ON platform.subscriptions(razorpay_subscription_id)
    WHERE razorpay_subscription_id IS NOT NULL;

-- ── platform.tenants: KYC/company detail columns + trial guard ─────────────

ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS pan             VARCHAR(20);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS gstin           VARCHAR(20);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS address_line1   VARCHAR(255);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS address_line2   VARCHAR(255);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS city            VARCHAR(100);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS state           VARCHAR(100);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS postal_code     VARCHAR(20);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS free_trial_used BOOLEAN NOT NULL DEFAULT FALSE;

-- ── platform.razorpay_webhook_events: async processor tracking ─────────────

ALTER TABLE platform.razorpay_webhook_events
    ADD COLUMN IF NOT EXISTS processed_at   TIMESTAMPTZ;
ALTER TABLE platform.razorpay_webhook_events
    ADD COLUMN IF NOT EXISTS process_status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED';
ALTER TABLE platform.razorpay_webhook_events
    ADD COLUMN IF NOT EXISTS process_error  TEXT;
CREATE INDEX IF NOT EXISTS ix_razorpay_webhook_events_status
    ON platform.razorpay_webhook_events(process_status)
    WHERE process_status <> 'DONE';

-- ── platform.plan_change_requests: two columns added later ─────────────────

ALTER TABLE platform.plan_change_requests
    ADD COLUMN IF NOT EXISTS replaces_subscription_id VARCHAR(64);
ALTER TABLE platform.plan_change_requests
    ADD COLUMN IF NOT EXISTS start_at                 TIMESTAMPTZ;

-- ── platform.pending_signups: create if missing, shape matched to prod ─────

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

-- Grants to the runtime role(s). Guarded on role existence so the migration
-- works in fresh CI containers (only hrms_app) AND prod (only ut_app).
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

-- ── platform.tenant_branding: Wave 1 workspace branding (per memory) ───────
-- Idempotent — creates only if the branding migration hasn't landed via psycopg
-- for a given environment. Prod already has this via apply_2026_08_10_branding.
CREATE TABLE IF NOT EXISTS platform.tenant_branding (
    tenant_id     UUID PRIMARY KEY REFERENCES platform.tenants(id) ON DELETE CASCADE,
    logo_url      TEXT,
    favicon_url   TEXT,
    primary_color VARCHAR(9)
        CHECK (primary_color IS NULL
               OR primary_color ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'),
    logo_r2_key   TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by    UUID
);
