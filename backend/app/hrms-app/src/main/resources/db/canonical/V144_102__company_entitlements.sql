-- V144.102: products are entitled per company, not only per workspace.
--
-- Why. A customer pays per company (owner decision, 2026-10-03). Today a product
-- is switched on per WORKSPACE in platform.tenant_modules, so Company A and
-- Company B of the same workspace cannot differ — Marketing Automation for one
-- company would light up for all of them.
--
-- What it does.
--   1. org.companies gains UNIQUE (id, tenant_id). id is already the primary key,
--      so every row already satisfies it; it only lets platform tables say "this
--      company belongs to THIS workspace" with a composite foreign key. No HRMS
--      code reads or writes it.
--   2. platform.company_modules: one row per (company, product, source). Source
--      lets a paid subscription, a trial and an audited manual override coexist;
--      a product is on for a company while any ACTIVE row is inside its period.
--   3. platform.subscriptions.company_id (nullable): which company a subscription
--      is commercially for. Existing rows stay NULL = the whole workspace, which
--      is what they meant when they were bought.
--   4. platform.tenant_modules.seats: the code writes it (PlanChangeService) and
--      production has it, but no canonical migration created it, so a fresh
--      database (tests, a new environment) failed on the first plan change.
--      ADD COLUMN IF NOT EXISTS makes it a no-op in production.
--
-- Unchanged: platform.tenant_modules and every caller of it. The company
-- resolver falls back to the workspace row, so HRMS (granted per workspace)
-- keeps working exactly as before.
--
-- Safety. Additive only. The new FKs point at rows that exist (new columns are
-- NULL). No RLS on platform.*, as for every other platform table (V002:4-7).
-- Idempotent. Production has Flyway OFF: apply by hand.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'uq_companies_id_tenant'
                      AND conrelid = 'org.companies'::regclass) THEN
        ALTER TABLE org.companies ADD CONSTRAINT uq_companies_id_tenant UNIQUE (id, tenant_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS platform.company_modules (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    company_id      UUID         NOT NULL,
    module_key      VARCHAR(50)  NOT NULL REFERENCES platform.module_catalog(key),
    status          VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    source          VARCHAR(20)  NOT NULL,
    subscription_id UUID         REFERENCES platform.subscriptions(id) ON DELETE SET NULL,
    seats           INTEGER,
    starts_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ends_at         TIMESTAMPTZ,
    reason          TEXT,
    granted_by      VARCHAR(255),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_company_modules_company FOREIGN KEY (company_id, tenant_id)
        REFERENCES org.companies (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT ck_company_modules_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT ck_company_modules_source CHECK (source IN ('SUBSCRIPTION', 'TRIAL', 'MANUAL')),
    CONSTRAINT ck_company_modules_period CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT ck_company_modules_seats  CHECK (seats IS NULL OR seats >= 0),
    -- A manual override must say why; an empty or one-word reason is refused.
    CONSTRAINT ck_company_modules_manual_reason
        CHECK (source <> 'MANUAL' OR (reason IS NOT NULL AND length(btrim(reason)) >= 5)),
    CONSTRAINT uq_company_module_source UNIQUE (company_id, module_key, source)
);

CREATE INDEX IF NOT EXISTS ix_company_modules_tenant ON platform.company_modules (tenant_id);
CREATE INDEX IF NOT EXISTS ix_company_modules_module_status ON platform.company_modules (module_key, status);

COMMENT ON TABLE platform.company_modules IS
    'Products switched on per company. Effective entitlement: an ACTIVE row inside [starts_at, ends_at), '
    'else the workspace row in platform.tenant_modules. Written by the platform admin API and billing.';

ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS company_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscriptions_company') THEN
        -- SET NULL (company_id) only: deleting a company must not blank the
        -- subscription's tenant_id, which billing reconciliation relies on.
        ALTER TABLE platform.subscriptions
            ADD CONSTRAINT fk_subscriptions_company FOREIGN KEY (company_id, tenant_id)
            REFERENCES org.companies (id, tenant_id) ON DELETE SET NULL (company_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_subscriptions_company_has_tenant') THEN
        -- A composite FK is not checked while tenant_id is NULL (MATCH SIMPLE),
        -- so a company-level subscription must name its workspace.
        ALTER TABLE platform.subscriptions
            ADD CONSTRAINT ck_subscriptions_company_has_tenant
            CHECK (company_id IS NULL OR tenant_id IS NOT NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_subscriptions_company ON platform.subscriptions (company_id)
    WHERE company_id IS NOT NULL;

ALTER TABLE platform.tenant_modules ADD COLUMN IF NOT EXISTS seats INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.company_modules TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA platform TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.company_modules TO hrms_app;
    END IF;
END $$;
