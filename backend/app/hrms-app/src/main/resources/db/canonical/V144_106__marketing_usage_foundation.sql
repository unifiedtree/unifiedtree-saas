-- V144.106: the data path for billing WhatsApp (Meta) usage through UnifiedTree.
--
-- Why. The business direction is that customers pay UnifiedTree for WhatsApp
-- usage and UnifiedTree settles with Meta. That needs Meta's partner /
-- line-of-credit approval, which does NOT exist yet. Today every customer
-- connects their own WhatsApp Business Account and Meta bills them directly.
-- Neither codebase records usage or cost at all (Marketing ignores the
-- conversation and pricing objects in Meta's webhooks).
--
-- This builds the internal foundation only, so usage can be recorded and seen
-- before any money moves:
--   1. platform.marketing_channel_accounts — which company a WhatsApp Business
--      Account belongs to commercially, its billing mode and a spend limit.
--      Operational WABA data (tokens, numbers, templates) stays in MongoDB.
--   2. platform.provider_rate_cards — provider cost and customer price,
--      versioned. Deliberately EMPTY: no Meta price is invented or hard-coded.
--      Every row must say where its price came from (source_note).
--   3. platform.usage_ledger — one row per billable provider event, with an
--      idempotency key so a redelivered webhook is recorded once, and a
--      reconciliation state for matching against Meta's own invoice.
--
-- Pooled billing stays OFF: every account defaults to DIRECT_CUSTOMER, and
-- platform.billing_settings.marketing_pooled_billing_enabled (V144.104) is FALSE.
-- The Java API refuses UNIFIEDTREE_POOLED / HYBRID while that switch is off, so
-- no customer can be labelled pooled before the approval exists.
--
-- Idempotency: a redelivered event is recorded once. Its payload_hash (SHA-256 of
-- the event as received) is stored, so the same idempotency key with a different
-- payload is refused (409) instead of silently dropped.
--
-- Safety. Additive, empty tables. Every FK is RESTRICT: usage rows are billing
-- records, and a channel account is DISCONNECTED, not deleted. Idempotent.
--
-- ── Applying by hand (Flyway is OFF in production) ─────────────────────────────
-- Order: strictly V144_101 → 102 → 103 → 104 → 105 → 106, BEFORE deploying the PR #12 revision
-- (104 needs 103: invoice_lines → module_plan_prices; 105 needs 102: company_modules.limits;
-- 106 needs 104: usage_ledger → invoice_lines; 102–106 need 102's uq_companies_id_tenant).
-- V144_107 is applied AFTER the deploy. Each file is one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f <file>
-- Each sets lock_timeout = 5s: a lock it cannot get fails the file (nothing applied) instead of queueing
-- HRMS requests behind it. Re-run it when traffic is lower.
-- This file: sixth, last before the deploy (after 104, whose invoice_lines usage_ledger references).
-- Rollback: full list in V144_101 (only while the tables are empty).

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.marketing_channel_accounts (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID          NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
    company_id          UUID          NOT NULL,
    provider            VARCHAR(30)   NOT NULL DEFAULT 'META_WHATSAPP',
    waba_id             VARCHAR(64)   NOT NULL,
    display_name        VARCHAR(255),
    billing_mode        VARCHAR(25)   NOT NULL DEFAULT 'DIRECT_CUSTOMER',
    monthly_spend_limit NUMERIC(14,2),
    currency            VARCHAR(3)    NOT NULL DEFAULT 'INR',
    status              VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT fk_channel_accounts_company FOREIGN KEY (company_id, tenant_id)
        REFERENCES org.companies (id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_channel_accounts_provider CHECK (provider IN ('META_WHATSAPP')),
    CONSTRAINT ck_channel_accounts_mode     CHECK (billing_mode IN ('DIRECT_CUSTOMER', 'UNIFIEDTREE_POOLED', 'HYBRID')),
    CONSTRAINT ck_channel_accounts_status   CHECK (status IN ('ACTIVE', 'DISCONNECTED')),
    CONSTRAINT ck_channel_accounts_limit    CHECK (monthly_spend_limit IS NULL OR monthly_spend_limit >= 0),
    CONSTRAINT uq_channel_accounts_waba     UNIQUE (provider, waba_id)
);
CREATE INDEX IF NOT EXISTS ix_channel_accounts_company ON platform.marketing_channel_accounts (company_id);

CREATE TABLE IF NOT EXISTS platform.provider_rate_cards (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    provider            VARCHAR(30)   NOT NULL,
    category            VARCHAR(40)   NOT NULL,
    market              VARCHAR(10)   NOT NULL,
    currency            VARCHAR(3)    NOT NULL,
    provider_unit_cost  NUMERIC(14,6) NOT NULL,
    customer_unit_price NUMERIC(14,6),
    valid_from          TIMESTAMPTZ   NOT NULL,
    valid_to            TIMESTAMPTZ,
    version_label       VARCHAR(50),
    source_note         TEXT          NOT NULL,
    created_by          VARCHAR(255),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_rate_cards_provider CHECK (provider IN ('META_WHATSAPP')),
    CONSTRAINT ck_rate_cards_values   CHECK (provider_unit_cost >= 0
                                             AND (customer_unit_price IS NULL OR customer_unit_price >= 0)),
    CONSTRAINT ck_rate_cards_period   CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT ck_rate_cards_source   CHECK (length(btrim(source_note)) >= 10)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_cards_open
    ON platform.provider_rate_cards (provider, category, market, currency) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS platform.usage_ledger (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key       VARCHAR(200)  NOT NULL,
    payload_hash          VARCHAR(64),
    tenant_id             UUID          NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
    company_id            UUID          NOT NULL,
    channel_account_id    UUID          REFERENCES platform.marketing_channel_accounts(id) ON DELETE RESTRICT,
    provider              VARCHAR(30)   NOT NULL,
    waba_id               VARCHAR(64),
    phone_number_id       VARCHAR(64),
    provider_event_id     VARCHAR(200),
    usage_type            VARCHAR(20)   NOT NULL,
    category              VARCHAR(40),
    market                VARCHAR(10),
    occurred_at           TIMESTAMPTZ   NOT NULL,
    quantity              NUMERIC(14,4) NOT NULL DEFAULT 1,
    rate_card_id          UUID          REFERENCES platform.provider_rate_cards(id),
    provider_cost         NUMERIC(14,6),
    customer_charge       NUMERIC(14,6),
    currency              VARCHAR(3),
    billing_mode          VARCHAR(25)   NOT NULL DEFAULT 'DIRECT_CUSTOMER',
    status                VARCHAR(20)   NOT NULL DEFAULT 'RECORDED',
    reconciliation_status VARCHAR(20)   NOT NULL DEFAULT 'UNRECONCILED',
    invoice_line_id       UUID          REFERENCES platform.invoice_lines(id) ON DELETE RESTRICT,
    raw                   JSONB,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT fk_usage_ledger_company FOREIGN KEY (company_id, tenant_id)
        REFERENCES org.companies (id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_usage_ledger_hash     CHECK (payload_hash IS NULL OR payload_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT uq_usage_ledger_idempotency UNIQUE (idempotency_key),
    CONSTRAINT ck_usage_ledger_provider CHECK (provider IN ('META_WHATSAPP')),
    CONSTRAINT ck_usage_ledger_type     CHECK (usage_type IN ('CONVERSATION', 'MESSAGE')),
    CONSTRAINT ck_usage_ledger_quantity CHECK (quantity > 0 AND quantity <= 10000),
    CONSTRAINT ck_usage_ledger_mode     CHECK (billing_mode IN ('DIRECT_CUSTOMER', 'UNIFIEDTREE_POOLED', 'HYBRID')),
    CONSTRAINT ck_usage_ledger_status   CHECK (status IN ('RECORDED', 'RATED', 'INVOICED', 'VOID')),
    CONSTRAINT ck_usage_ledger_recon    CHECK (reconciliation_status IN ('UNRECONCILED', 'MATCHED', 'MISMATCH', 'DISPUTED')),
    -- A rated row knows which price it was rated at and what it cost.
    CONSTRAINT ck_usage_ledger_rated    CHECK (status NOT IN ('RATED', 'INVOICED')
                                               OR (rate_card_id IS NOT NULL AND provider_cost IS NOT NULL
                                                   AND currency IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_usage_ledger_company_time ON platform.usage_ledger (company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_ledger_tenant_time  ON platform.usage_ledger (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_ledger_unreconciled ON platform.usage_ledger (reconciliation_status)
    WHERE reconciliation_status <> 'MATCHED';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE ON platform.marketing_channel_accounts,
            platform.provider_rate_cards, platform.usage_ledger TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA platform TO hrms_app;
        GRANT SELECT, INSERT, UPDATE ON platform.marketing_channel_accounts,
            platform.provider_rate_cards, platform.usage_ledger TO hrms_app;
    END IF;
END $$;

-- Usage rows are billing records (VOID, never deleted); a channel is DISCONNECTED; a rate card is closed.
-- Explicit, because V089's ALTER DEFAULT PRIVILEGES (where its owner role ran it) hands DELETE on every new
-- platform table to the app roles; production has no default privileges, so this makes both the same.
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app', 'app_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE DELETE ON platform.marketing_channel_accounts, platform.provider_rate_cards, platform.usage_ledger FROM %I', r);
        END IF;
    END LOOP;
END $$;

