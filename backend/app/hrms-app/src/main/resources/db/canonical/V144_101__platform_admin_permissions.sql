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
-- Numbered 144.1: V143.70–V143.88 are reserved for the HRMS team. Idempotent.
-- Production has Flyway OFF: apply by hand.

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
     'Switch a product on or off for one company outside its subscription (audited, reason required).', 'HIGH',
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
