-- V144.105: Marketing Automation joins UnifiedTree identity.
--
-- Why. Marketing Automation (Node + MongoDB) was a standalone SaaS with its own
-- users, passwords and subscriptions. It becomes a UnifiedTree product: people
-- sign in with their UnifiedTree account, pick a company, and Marketing checks
-- with UnifiedTree that the company has the product. Two things are needed in
-- PostgreSQL for that, and both are absent today:
--
--   1. platform.marketing_identity_map — which Mongo user stands for which
--      UnifiedTree company or account. Every Marketing document is owned by a
--      Mongo user id (`user_id`), so each company is mapped to one Marketing
--      owner principal (kind COMPANY_OWNER), and each person working in that
--      company to their own principal (kind MEMBER). Pre-merge Marketing
--      customers are imported as LEGACY_USER rows and stay PENDING or
--      QUARANTINED until a person confirms the match — ownership is never
--      guessed.
--   2. platform.sso_handoff_tickets — a single-use, short-lived ticket that
--      carries a verified (account, workspace, company) from UnifiedTree to
--      Marketing. Only the SHA-256 of the ticket is stored; Marketing redeems it
--      server-to-server and it cannot be redeemed twice.
--
-- Also: the existing plan `marketing` (LAUNCHING_SOON) includes no module, so
-- buying it would switch nothing on. It is linked to the existing catalogue
-- module `whatsapp` (WhatsApp Automation), only if its list is still empty.
-- The plan is not purchasable while LAUNCHING_SOON, so this changes nothing
-- for customers today.
--
-- Safety. Additive; the plan update touches one row only if it is empty. The
-- identity map is the only record of which Mongo user is whose, so its FKs are
-- RESTRICT (an account, workspace or company with mapped rows is archived; a
-- mapping is RETIRED, never deleted). SSO tickets are 60-second records and
-- cascade with their account / workspace / company. Idempotent.
--
-- ── Applying by hand (Flyway is OFF in production) ─────────────────────────────
-- Order: strictly V144_101 → 102 → 103 → 104 → 105 → 106, BEFORE deploying the PR #12 revision
-- (104 needs 103: invoice_lines → module_plan_prices; 105 needs 102: company_modules.limits;
-- 106 needs 104: usage_ledger → invoice_lines; 102–106 need 102's uq_companies_id_tenant).
-- V144_107 is applied AFTER the deploy. Each file is one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f <file>
-- Each sets lock_timeout = 5s: a lock it cannot get fails the file (nothing applied) instead of queueing
-- HRMS requests behind it. Re-run it when traffic is lower.
-- This file: fifth (after 102, whose company_modules gains limits here).
-- Rollback: full list in V144_101 (set the marketing plan's included_modules back to '{}').

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.marketing_identity_map (
    id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                      VARCHAR(20)  NOT NULL,
    legacy_marketing_user_id  VARCHAR(24)  NOT NULL,
    legacy_role               VARCHAR(30),
    legacy_email              VARCHAR(255),
    account_id                UUID         REFERENCES platform.accounts(id) ON DELETE RESTRICT,
    tenant_id                 UUID         REFERENCES platform.tenants(id) ON DELETE RESTRICT,
    company_id                UUID,
    status                    VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    source                    VARCHAR(20)  NOT NULL,
    quarantine_reason         TEXT,
    mapped_at                 TIMESTAMPTZ,
    mapped_by                 VARCHAR(255),
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_marketing_map_company FOREIGN KEY (company_id, tenant_id)
        REFERENCES org.companies (id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_marketing_map_kind    CHECK (kind IN ('COMPANY_OWNER', 'MEMBER', 'LEGACY_USER')),
    CONSTRAINT ck_marketing_map_status  CHECK (status IN ('PENDING', 'MAPPED', 'QUARANTINED', 'RETIRED')),
    CONSTRAINT ck_marketing_map_source  CHECK (source IN ('SSO', 'BACKFILL', 'MANUAL')),
    CONSTRAINT ck_marketing_map_mongo_id CHECK (legacy_marketing_user_id ~ '^[0-9a-f]{24}$'),
    CONSTRAINT ck_marketing_map_company_has_tenant CHECK (company_id IS NULL OR tenant_id IS NOT NULL),
    -- A MAPPED row knows exactly whose it is: a company owner knows its company,
    -- a member knows its account and company.
    CONSTRAINT ck_marketing_map_mapped CHECK (
        status <> 'MAPPED'
        OR (kind = 'COMPANY_OWNER' AND company_id IS NOT NULL)
        OR (kind = 'MEMBER' AND account_id IS NOT NULL AND company_id IS NOT NULL)
        OR (kind = 'LEGACY_USER' AND account_id IS NOT NULL AND tenant_id IS NOT NULL)),
    CONSTRAINT ck_marketing_map_quarantine CHECK (status <> 'QUARANTINED' OR quarantine_reason IS NOT NULL),
    CONSTRAINT uq_marketing_map_legacy_user UNIQUE (legacy_marketing_user_id)
);

-- One Marketing owner principal per company, one principal per person per company.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_map_company_owner
    ON platform.marketing_identity_map (company_id) WHERE kind = 'COMPANY_OWNER' AND status = 'MAPPED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_map_member
    ON platform.marketing_identity_map (account_id, company_id) WHERE kind = 'MEMBER' AND status = 'MAPPED';
CREATE INDEX IF NOT EXISTS ix_marketing_map_tenant ON platform.marketing_identity_map (tenant_id);
CREATE INDEX IF NOT EXISTS ix_marketing_map_status ON platform.marketing_identity_map (status);

CREATE TABLE IF NOT EXISTS platform.sso_handoff_tickets (
    ticket_hash  VARCHAR(64)  PRIMARY KEY,   -- VARCHAR, not CHAR(n): bpchar breaks String entity mapping (V104 incident)
    audience     VARCHAR(30)  NOT NULL,
    account_id   UUID         NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    tenant_id    UUID         NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    company_id   UUID         NOT NULL,
    auth_user_id UUID         NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ  NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_ip   VARCHAR(45),
    user_agent   VARCHAR(300),
    CONSTRAINT fk_sso_ticket_company FOREIGN KEY (company_id, tenant_id)
        REFERENCES org.companies (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT ck_sso_ticket_audience CHECK (audience IN ('marketing')),
    CONSTRAINT ck_sso_ticket_hash     CHECK (ticket_hash ~ '^[0-9a-f]{64}$'),
    -- A handoff is short-lived by construction: at most five minutes.
    CONSTRAINT ck_sso_ticket_ttl      CHECK (expires_at > created_at
                                             AND expires_at <= created_at + INTERVAL '5 minutes')
);
CREATE INDEX IF NOT EXISTS ix_sso_tickets_expires ON platform.sso_handoff_tickets (expires_at);

UPDATE platform.module_plans
   SET included_modules = ARRAY['whatsapp']::text[], updated_at = now()
 WHERE key = 'marketing'
   AND cardinality(included_modules) = 0
   AND EXISTS (SELECT 1 FROM platform.module_catalog WHERE key = 'whatsapp');

-- Structured limits for what a plan allows (contacts, campaigns, agents, ...).
-- module_plans.features is the website's bullet list, not machine-readable, so
-- Marketing had nowhere in UnifiedTree to read "how many contacts may this
-- company keep". Keys are Marketing's own vocabulary (see
-- MARKETING_FEATURE_MAPPING.md); an absent key means "fall back to Marketing's
-- legacy plan" during the migration, not "unlimited". A company row may
-- override its plan's limits (e.g. a negotiated contract).
ALTER TABLE platform.module_plans   ADD COLUMN IF NOT EXISTS limits JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE platform.company_modules ADD COLUMN IF NOT EXISTS limits JSONB;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_module_plans_limits_object') THEN
        ALTER TABLE platform.module_plans
            ADD CONSTRAINT ck_module_plans_limits_object CHECK (jsonb_typeof(limits) = 'object');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_company_modules_limits_object') THEN
        ALTER TABLE platform.company_modules
            ADD CONSTRAINT ck_company_modules_limits_object CHECK (limits IS NULL OR jsonb_typeof(limits) = 'object');
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE ON platform.marketing_identity_map TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.sso_handoff_tickets TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA platform TO hrms_app;
        GRANT SELECT, INSERT, UPDATE ON platform.marketing_identity_map TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.sso_handoff_tickets TO hrms_app;
    END IF;
END $$;

-- A mapping is RETIRED, never deleted (SSO tickets keep DELETE: expired ones are purged).
-- Explicit, because V089's ALTER DEFAULT PRIVILEGES (where its owner role ran it) hands DELETE on every new
-- platform table to the app roles; production has no default privileges, so this makes both the same.
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app', 'app_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE DELETE ON platform.marketing_identity_map FROM %I', r);
        END IF;
    END LOOP;
END $$;

