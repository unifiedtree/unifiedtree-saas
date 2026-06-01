-- ============================================================================
-- V035 - Global account portal + explicit workspace ownership
-- ============================================================================
-- This layer sits above tenant-scoped ERP data:
--
--   platform.accounts              = one real person across UnifiedTree
--   platform.tenants               = one workspace / customer tenant
--   platform.account_workspaces    = membership + simple role in a workspace
--
-- Tenant-scoped auth.user_credentials still exists and remains the source of
-- truth for workspace JWT sessions. account_workspaces.auth_user_id links the
-- global account to that tenant-scoped login row.
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE platform.account_status AS ENUM ('ACTIVE','LOCKED','DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE platform.workspace_role AS ENUM ('OWNER','ADMIN','MANAGER','EMPLOYEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS platform.accounts (
    id                  UUID                        PRIMARY KEY,
    email               VARCHAR(255)                NOT NULL UNIQUE,
    display_name        VARCHAR(150)                NOT NULL,
    phone               VARCHAR(20),
    password_hash       VARCHAR(255)                NOT NULL,
    status              platform.account_status     NOT NULL DEFAULT 'ACTIVE',
    last_login_at       TIMESTAMPTZ,
    failed_login_count  INT                         NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    password_updated_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_email_lower ON platform.accounts (lower(email));
CREATE INDEX IF NOT EXISTS idx_accounts_status ON platform.accounts (status);

ALTER TABLE platform.tenants
  ADD COLUMN IF NOT EXISTS owner_account_id      UUID REFERENCES platform.accounts(id),
  ADD COLUMN IF NOT EXISTS created_by_account_id UUID REFERENCES platform.accounts(id);

CREATE TABLE IF NOT EXISTS platform.account_workspaces (
    id                  UUID                        PRIMARY KEY,
    account_id          UUID                        NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    tenant_id           UUID                        NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    auth_user_id        UUID                        NOT NULL REFERENCES auth.user_credentials(id) ON DELETE CASCADE,
    role                platform.workspace_role     NOT NULL DEFAULT 'EMPLOYEE',
    default_workspace   BOOLEAN                     NOT NULL DEFAULT FALSE,
    status              VARCHAR(20)                 NOT NULL DEFAULT 'ACTIVE',
    invited_by_account_id UUID                      REFERENCES platform.accounts(id),
    joined_at           TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ                 NOT NULL DEFAULT now(),

    CONSTRAINT uq_account_workspace UNIQUE (account_id, tenant_id),
    CONSTRAINT uq_workspace_auth_user UNIQUE (tenant_id, auth_user_id),
    CONSTRAINT ck_account_workspace_status CHECK (status IN ('ACTIVE','INVITED','SUSPENDED','REMOVED'))
);

CREATE INDEX IF NOT EXISTS idx_account_workspaces_account
    ON platform.account_workspaces(account_id, status);
CREATE INDEX IF NOT EXISTS idx_account_workspaces_tenant
    ON platform.account_workspaces(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_account_workspaces_auth_user
    ON platform.account_workspaces(tenant_id, auth_user_id);

-- SaaS module catalog additions. These can be listed as locked modules before
-- their business backends are shipped; tenant_modules remains the hard gate.
INSERT INTO platform.module_catalog (key, display_name, category, base_price_inr, is_available) VALUES
    ('whatsapp', 'WhatsApp Automation', 'Engagement', NULL, FALSE),
    ('billing',  'Billing & Subscriptions', 'Platform', NULL, FALSE)
ON CONFLICT (key) DO NOTHING;

-- Simple workspace-facing roles requested for the product UI. Legacy roles are
-- kept for existing HRMS controllers; these are the roles the new account layer
-- exposes as workspaceRole.
INSERT INTO rbac.roles (id, tenant_id, code, display_name, description, is_system, is_default_for_new_users) VALUES
    ('00000000-0000-0000-0000-000000000010', NULL, 'OWNER',   'Owner',   'Workspace owner with billing, module, user, and all active-module access.', TRUE, FALSE),
    ('00000000-0000-0000-0000-000000000011', NULL, 'ADMIN',   'Admin',   'Workspace/company administrator without billing ownership.', TRUE, FALSE),
    ('00000000-0000-0000-0000-000000000012', NULL, 'MANAGER', 'Manager', 'Team or function manager with assigned module access.', TRUE, FALSE)
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('workspace.account.read',   'Read own account and workspace list',       'workspace', 'Allows global account portal workspace listing.'),
    ('workspace.context.read',   'Read current workspace context',            'workspace', 'Allows app shell to build module dashboard.'),
    ('workspace.users.manage',   'Manage workspace users and access',         'workspace', 'Invite, suspend, and assign workspace users.'),
    ('workspace.modules.read',   'Read active and locked modules',            'workspace', 'Read active module list and upgrade catalogue.'),
    ('workspace.modules.buy',    'Buy or request locked modules',             'workspace', 'Owner-only module activation/payment entry point.'),
    ('workspace.billing.manage', 'Manage billing and subscription settings',  'workspace', 'Owner-only billing operations.')
ON CONFLICT (code) DO NOTHING;

-- OWNER sees all tenant-facing permissions. Exclude platform-admin permissions
-- that belong to UnifiedTree internal staff.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, p.code
FROM rbac.permissions p
WHERE p.module <> 'platform'
ON CONFLICT DO NOTHING;

-- ADMIN can manage users/modules already active, but cannot buy or manage billing.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000011', 'workspace.account.read'),
    ('00000000-0000-0000-0000-000000000011', 'workspace.context.read'),
    ('00000000-0000-0000-0000-000000000011', 'workspace.users.manage'),
    ('00000000-0000-0000-0000-000000000011', 'workspace.modules.read'),
    ('00000000-0000-0000-0000-000000000011', 'org.company.read'),
    ('00000000-0000-0000-0000-000000000011', 'org.company.write'),
    ('00000000-0000-0000-0000-000000000011', 'hrms.employee.read'),
    ('00000000-0000-0000-0000-000000000011', 'hrms.employee.write'),
    ('00000000-0000-0000-0000-000000000011', 'attendance.team.read'),
    ('00000000-0000-0000-0000-000000000011', 'leave.request.approve')
ON CONFLICT DO NOTHING;

-- MANAGER gets context + team/task permissions. Module-specific permissions can
-- be added later without changing the role model users understand.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000012', 'workspace.account.read'),
    ('00000000-0000-0000-0000-000000000012', 'workspace.context.read'),
    ('00000000-0000-0000-0000-000000000012', 'hrms.employee.read'),
    ('00000000-0000-0000-0000-000000000012', 'attendance.team.read'),
    ('00000000-0000-0000-0000-000000000012', 'leave.request.approve')
ON CONFLICT DO NOTHING;

-- Existing EMPLOYEE role also needs the new generic context permissions.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000004', 'workspace.account.read'),
    ('00000000-0000-0000-0000-000000000004', 'workspace.context.read')
ON CONFLICT DO NOTHING;
