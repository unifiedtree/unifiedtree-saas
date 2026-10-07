-- V144.102: products are entitled per company, not only per workspace.
--
-- Why. Today a product is switched on per WORKSPACE in platform.tenant_modules, so
-- Company A and Company B of the same workspace cannot differ — Marketing Automation
-- for one company would light up for all of them. The business keeps ONE subscription
-- this week (owner decision, 6 Oct 2026); per-company subscriptions come with next
-- week's per-company billing, which reuses subscriptions.company_id from this file.
--
-- platform.company_modules is for NON-HRMS products only (Marketing today):
-- HRMS keeps its per-workspace switch (tenant_modules + TenantModuleGuard +
-- SubscriptionAccessGuard), and CompanyEntitlementService.setManual refuses HRMS
-- module keys, so the console cannot show an HRMS suspension that HRMS ignores.
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
-- Every FK is RESTRICT: a company or workspace with entitlement rows is archived,
-- not deleted, and rows are retired (status) instead of deleted. Idempotent.
--
-- Locks: ADD CONSTRAINT uq_companies_id_tenant takes an ACCESS EXCLUSIVE lock on
-- org.companies (read by every HRMS request) while it builds a unique index over a
-- small table; lock_timeout below makes it give up after 5 s rather than queue.
--
-- ── Applying by hand (Flyway is OFF in production) ─────────────────────────────
-- Order: strictly V144_101 → 102 → 103 → 104 → 105 → 106, BEFORE deploying the PR #12 revision
-- (104 needs 103: invoice_lines → module_plan_prices; 105 needs 102: company_modules.limits;
-- 106 needs 104: usage_ledger → invoice_lines; 102–106 need 102's uq_companies_id_tenant).
-- V144_107 is applied AFTER the deploy. Each file is one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f <file>
-- Each sets lock_timeout = 5s: a lock it cannot get fails the file (nothing applied) instead of queueing
-- HRMS requests behind it. Re-run it when traffic is lower.
-- This file: second (after 101). 104, 105 and 106 need its uq_companies_id_tenant; 105 needs
-- company_modules. Rollback: the full list is in V144_101 (102: drop uq_companies_id_tenant LAST,
-- never drop tenant_modules.seats).

SET LOCAL lock_timeout = '5s';

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
    tenant_id       UUID         NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
    company_id      UUID         NOT NULL,
    module_key      VARCHAR(50)  NOT NULL REFERENCES platform.module_catalog(key),
    status          VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    source          VARCHAR(20)  NOT NULL,
    subscription_id UUID         REFERENCES platform.subscriptions(id) ON DELETE RESTRICT,
    seats           INTEGER,
    starts_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ends_at         TIMESTAMPTZ,
    reason          TEXT,
    granted_by      VARCHAR(255),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_company_modules_company FOREIGN KEY (company_id, tenant_id)
        REFERENCES org.companies (id, tenant_id) ON DELETE RESTRICT,
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
    'Non-HRMS products (Marketing) switched on per company. Effective entitlement: an ACTIVE row inside '
    '[starts_at, ends_at), else the workspace row in platform.tenant_modules, paused like HRMS when the '
    'subscription lapses. Rows are retired (status), never deleted.';

ALTER TABLE platform.subscriptions ADD COLUMN IF NOT EXISTS company_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscriptions_company') THEN
        -- RESTRICT: NULL means "the whole workspace", so SET NULL would turn a
        -- company's subscription into a business-wide one (switching the product on
        -- for every company) when the company was deleted. Companies are archived.
        ALTER TABLE platform.subscriptions
            ADD CONSTRAINT fk_subscriptions_company FOREIGN KEY (company_id, tenant_id)
            REFERENCES org.companies (id, tenant_id) ON DELETE RESTRICT;
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
        GRANT SELECT, INSERT, UPDATE ON platform.company_modules TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA platform TO hrms_app;
        GRANT SELECT, INSERT, UPDATE ON platform.company_modules TO hrms_app;
    END IF;
END $$;

-- Entitlement rows are retired (status CANCELLED / SUSPENDED), never deleted.
-- Explicit, because V089's ALTER DEFAULT PRIVILEGES (where its owner role ran it) hands DELETE on every new
-- platform table to the app roles; production has no default privileges, so this makes both the same.
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app', 'app_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE DELETE ON platform.company_modules FROM %I', r);
        END IF;
    END LOOP;
END $$;

