-- ============================================================================
-- V089 - Comprehensive schema catch-up: mirrors every platform.* change that
--        shipped to prod via psycopg scripts since V087 but was never brought
--        into the Flyway canonical stream. Testcontainers-backed ITs run Flyway
--        from V001 against a fresh Postgres container, so any drift means:
--
--          * missing table   → "relation does not exist"
--          * missing column  → "column does not exist"
--          * missing status  → CHECK constraint violation on insert
--
--        all of which cascade into 500s that fail unrelated IT suites
--        (LetterFlowIT, AuditControllerIT, WorkspaceAccessIT, etc.) because
--        their tests share the same Spring context boot.
--
-- Idempotent: every DDL uses IF NOT EXISTS or a DO-block existence guard, so
-- prod (where the psycopg scripts already applied) treats this as a no-op.
-- ============================================================================

-- ── 1. platform.razorpay_plans — pricing catalog for Razorpay Subscriptions
--    Created by scripts/setup_razorpay_plans.py originally; mirror here.
CREATE TABLE IF NOT EXISTS platform.razorpay_plans (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key         VARCHAR(64)  NOT NULL,
    billing_cycle      VARCHAR(16)  NOT NULL,
    razorpay_plan_id   VARCHAR(64)  NOT NULL,
    unit_price_paise   BIGINT       NOT NULL,
    currency           VARCHAR(8)   NOT NULL DEFAULT 'INR',
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS razorpay_plans_module_key_billing_cycle_key
    ON platform.razorpay_plans (module_key, billing_cycle);

-- ── 2. platform.razorpay_webhook_events — inbound webhook log
--    Async processor writes process_status/processed_at once it's done.
CREATE TABLE IF NOT EXISTS platform.razorpay_webhook_events (
    event_id         VARCHAR(128) PRIMARY KEY,
    event_type       VARCHAR(64)  NOT NULL,
    subscription_id  VARCHAR(64),
    payload          JSONB,
    received_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at     TIMESTAMPTZ,
    process_status   VARCHAR(32)  NOT NULL DEFAULT 'RECEIVED',
    process_error    TEXT
);
CREATE INDEX IF NOT EXISTS ix_razorpay_webhook_sub
    ON platform.razorpay_webhook_events (subscription_id)
    WHERE subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_razorpay_webhook_events_status
    ON platform.razorpay_webhook_events (process_status)
    WHERE process_status <> 'DONE';

-- ── 3. platform.plan_change_requests — in-workspace autopay setup ledger
--    See scripts/plan_change_flow.py + PlanChangeService.
CREATE TABLE IF NOT EXISTS platform.plan_change_requests (
    id                       UUID         PRIMARY KEY,
    tenant_id                UUID         NOT NULL,
    initiator_account_id     UUID         NOT NULL,
    plan_items               JSONB        NOT NULL,
    billing_cycle            VARCHAR(16)  NOT NULL,
    razorpay_subscription_id VARCHAR(64),
    razorpay_customer_id     VARCHAR(64),
    checkout_short_url       TEXT,
    status                   VARCHAR(24)  NOT NULL DEFAULT 'AWAITING_MANDATE',
    failure_reason           TEXT,
    expires_at               TIMESTAMPTZ  NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
    activated_at             TIMESTAMPTZ,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    replaces_subscription_id VARCHAR(64),
    start_at                 TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_change_requests_razorpay_subscription_id
    ON platform.plan_change_requests (razorpay_subscription_id)
    WHERE razorpay_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_plan_change_requests_tenant_status
    ON platform.plan_change_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_change_requests_expires_at
    ON platform.plan_change_requests (expires_at)
    WHERE status = 'AWAITING_MANDATE';
CREATE INDEX IF NOT EXISTS ix_plan_change_requests_replaces
    ON platform.plan_change_requests (replaces_subscription_id)
    WHERE replaces_subscription_id IS NOT NULL;

-- ── 4. platform.subscriptions — broaden status enum + 15 late-added columns
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
    ON platform.subscriptions (razorpay_subscription_id)
    WHERE razorpay_subscription_id IS NOT NULL;

-- ── 5. platform.tenants — KYC/company detail columns + free-trial guard
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS pan             VARCHAR(20);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS gstin           VARCHAR(20);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS address_line1   VARCHAR(255);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS address_line2   VARCHAR(255);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS city            VARCHAR(100);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS state           VARCHAR(100);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS postal_code     VARCHAR(20);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS free_trial_used BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 6. platform.pending_signups — paid-plan signup rows awaiting mandate
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

-- ── 7. platform.tenant_branding — per-workspace branding (Wave 1)
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

-- ── 8. Grants — mirror the dual-role pattern; guarded on role existence.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.razorpay_plans          TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.razorpay_webhook_events TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.plan_change_requests    TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pending_signups         TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.razorpay_plans          TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.razorpay_webhook_events TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.plan_change_requests    TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pending_signups         TO hrms_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.razorpay_plans          TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.razorpay_webhook_events TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.plan_change_requests    TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pending_signups         TO app_user;
    END IF;
END $$;
