-- V144.101: permissions for the UnifiedTree platform admin console (admin.unifiedtree.com).
--
-- Why. Until now the platform operator had four permissions (platform.admin and
-- platform.tenant.read/.approve/.reject, V019), enough to approve sign-ups and
-- nothing else. The admin console lists companies, accounts, products, prices,
-- subscriptions, invoices and payments across every workspace, and changes a few
-- of them (prices, company entitlements, billing profiles, invoices). Each of
-- those gets its own permission so a future operator role can be read-only.
--
-- Reused, not duplicated: workspace (tenant) directory reads keep using the
-- existing platform.tenant.read.
--
-- Safety. module = 'platform', so OwnerPermissionInvariantCheck ignores these
-- (it checks OWNER holds every NON-platform permission) and the "new permissions
-- available" notice for business-made roles filters them out (NewPermissions
-- PLATFORM_MODULE). They are granted only to the built-in PLATFORM_SUPER_ADMIN
-- (…0006), which V143_92 already confines to the platform tenant. No workspace
-- role gains anything.
--
-- Numbered V144_101: V143_70–V143_88 and V144_1–V144_99 belong to the HRMS lane (V144_1 billing
-- reminders, V144_2, next week's per-company billing from V144_4); V144_100–V144_199 are the admin /
-- Marketing stream's. Idempotent.
--
-- ── Applying by hand (Flyway is OFF in production) ─────────────────────────────
-- Order: strictly V144_101 → 102 → 103 → 104 → 105 → 106, BEFORE deploying the PR #12 revision
-- (104 needs 103: invoice_lines → module_plan_prices; 105 needs 102: company_modules.limits;
-- 106 needs 104: usage_ledger → invoice_lines; 102–106 need 102's uq_companies_id_tenant).
-- V144_107 is applied AFTER the deploy. Each file is one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f <file>
-- Each sets lock_timeout = 5s: a lock it cannot get fails the file (nothing applied) instead of queueing
-- HRMS requests behind it. Re-run it when traffic is lower.
-- This file: first. Needs nothing from the others.
--
-- ── Rollback, in REVERSE order (107 → 106 → … → 101), each as one transaction ──
--   107: see V144_107.
--   106: DROP TABLE platform.usage_ledger, platform.provider_rate_cards, platform.marketing_channel_accounts;
--        only while they are empty (usage rows are billing records: export them first, never just drop).
--   105: DROP TABLE platform.sso_handoff_tickets; DROP TABLE platform.marketing_identity_map (only while
--        no row is MAPPED: it is the only Mongo ↔ UnifiedTree identity record);
--        UPDATE platform.module_plans SET included_modules = '{}' WHERE key = 'marketing';
--        ALTER TABLE platform.company_modules DROP CONSTRAINT ck_company_modules_limits_object, DROP COLUMN limits;
--        ALTER TABLE platform.module_plans DROP CONSTRAINT ck_module_plans_limits_object, DROP COLUMN limits.
--   104: DROP TRIGGER trg_guard_issued_invoice_lines ON platform.invoice_lines;
--        DROP TRIGGER trg_guard_issued_invoice ON platform.invoices;
--        DROP FUNCTION platform.guard_issued_invoice_lines(), platform.guard_issued_invoice();
--        DROP TABLE platform.invoice_lines, platform.invoices, platform.invoice_number_series,
--                   platform.company_billing_profiles   -- only while no invoice was ever issued;
--        ALTER TABLE platform.billing_settings DROP CONSTRAINT ck_billing_settings_invoice_prefix,
--            DROP CONSTRAINT ck_billing_settings_sac, DROP COLUMN seller_legal_name, DROP COLUMN seller_gstin,
--            DROP COLUMN seller_pan, DROP COLUMN seller_address, DROP COLUMN seller_state_code,
--            DROP COLUMN seller_email, DROP COLUMN invoice_prefix, DROP COLUMN default_gst_rate_pct,
--            DROP COLUMN invoice_due_days, DROP COLUMN default_sac_code,
--            DROP COLUMN marketing_pooled_billing_enabled.
--   103: DROP TABLE platform.module_plan_prices (after 104: invoice_lines references it).
--   102: DROP TABLE platform.company_modules;
--        ALTER TABLE platform.subscriptions DROP CONSTRAINT fk_subscriptions_company,
--            DROP CONSTRAINT ck_subscriptions_company_has_tenant, DROP COLUMN company_id;
--        NEVER drop platform.tenant_modules.seats: production had it before this file and PlanChangeService
--        writes it (the ADD COLUMN IF NOT EXISTS was a no-op there);
--        ALTER TABLE org.companies DROP CONSTRAINT uq_companies_id_tenant  -- LAST, after every composite FK
--        that uses it (102, 104, 105, 106) is gone.
--   101: DELETE FROM rbac.permissions WHERE code IN ('platform.company.read', 'platform.account.read',
--        'platform.catalog.read', 'platform.catalog.manage', 'platform.subscription.read',
--        'platform.billing.read', 'platform.billing.manage', 'platform.entitlement.manage',
--        'platform.audit.read', 'platform.marketing.read', 'platform.marketing.manage');
--        their rbac.role_permissions rows cascade.

SET LOCAL lock_timeout = '5s';

INSERT INTO rbac.permissions (code, display_name, module, description, risk_level, warning) VALUES
    ('platform.company.read',      'Read companies across workspaces', 'platform',
     'List and read every workspace''s companies, their products and billing state.', 'MEDIUM', NULL),
    ('platform.account.read',      'Read accounts and memberships',    'platform',
     'List people''s sign-in accounts and which workspaces they belong to.',           'MEDIUM', NULL),
    ('platform.catalog.read',      'Read products and plans',          'platform',
     'Read the product catalogue, plans and their price history.',                    'LOW',    NULL),
    ('platform.catalog.manage',    'Change plan prices',               'platform',
     'Publish a new price for a plan. Existing subscriptions keep the price they bought at.', 'HIGH',
     'New checkouts are charged the new price immediately.'),
    ('platform.subscription.read', 'Read subscriptions',               'platform',
     'Read every workspace''s and company''s subscriptions.',                           'MEDIUM', NULL),
    ('platform.billing.read',      'Read invoices and payments',       'platform',
     'Read invoices, payments and company billing profiles.',        'MEDIUM', NULL),
    ('platform.billing.manage',    'Issue invoices and edit billing profiles', 'platform',
     'Issue or void invoices and edit a company''s billing profile.',                   'HIGH',
     'An issued invoice cannot be edited, only voided and re-issued.'),
    ('platform.entitlement.manage','Grant or suspend a product for a company', 'platform',
     'Switch Marketing Automation on or off for one company outside its subscription (audited, reason required). HRMS modules stay per workspace.', 'HIGH',
     'Overrides what the company paid for until it is removed.'),
    ('platform.marketing.read',    'Read Marketing Automation administration', 'platform',
     'Read Marketing Automation companies, channels, usage and identity mapping.',    'LOW',    NULL),
    ('platform.marketing.manage',  'Administer Marketing Automation',  'platform',
     'Manage Marketing Automation templates, quick replies, AI models and channel settings.', 'HIGH', NULL),
    ('platform.audit.read',        'Read the audit trail',             'platform',
     'Read platform audit events and a workspace''s audit trail.',                     'MEDIUM', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000006'::uuid, p.code
  FROM rbac.permissions p
 WHERE p.code IN ('platform.company.read', 'platform.account.read', 'platform.catalog.read',
                  'platform.catalog.manage', 'platform.subscription.read', 'platform.billing.read',
                  'platform.billing.manage', 'platform.entitlement.manage', 'platform.marketing.read',
                  'platform.marketing.manage', 'platform.audit.read')
   AND EXISTS (SELECT 1 FROM rbac.roles r
                WHERE r.id = '00000000-0000-0000-0000-000000000006'::uuid
                  AND r.tenant_id IS NULL AND r.code = 'PLATFORM_SUPER_ADMIN')
ON CONFLICT DO NOTHING;
