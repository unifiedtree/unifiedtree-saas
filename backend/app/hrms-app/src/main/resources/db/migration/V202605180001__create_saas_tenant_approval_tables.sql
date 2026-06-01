-- UnifiedTree SaaS onboarding and manual approval flow.

CREATE TABLE IF NOT EXISTS tenants (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             VARCHAR(255) NOT NULL,
    slug             VARCHAR(80) NOT NULL UNIQUE,
    status           VARCHAR(40) NOT NULL DEFAULT 'PENDING_APPROVAL',
    admin_name       VARCHAR(255) NOT NULL,
    admin_email      VARCHAR(255) NOT NULL,
    admin_mobile     VARCHAR(30),
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at      TIMESTAMPTZ,
    approved_by      UUID,
    rejected_at      TIMESTAMPTZ,
    rejected_by      UUID,
    rejection_reason TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    version          BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_tenants_status
        CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED'))
);

CREATE TABLE IF NOT EXISTS tenant_domains (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subdomain   VARCHAR(80) NOT NULL UNIQUE,
    full_domain VARCHAR(255) NOT NULL UNIQUE,
    is_primary  BOOLEAN NOT NULL DEFAULT true,
    status      VARCHAR(40) NOT NULL DEFAULT 'RESERVED',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_tenant_domains_status
        CHECK (status IN ('RESERVED', 'ACTIVE', 'DISABLED'))
);

CREATE TABLE IF NOT EXISTS module_catalog (
    module_key  VARCHAR(60) PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    description TEXT,
    category    VARCHAR(80) NOT NULL DEFAULT 'HRMS',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    sort_order  INT NOT NULL DEFAULT 100,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_module_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    module_key        VARCHAR(60) NOT NULL REFERENCES module_catalog(module_key),
    status            VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at        TIMESTAMPTZ,
    decided_by        UUID,
    rejection_reason  TEXT,
    CONSTRAINT uq_tenant_module_request UNIQUE (tenant_id, module_key),
    CONSTRAINT ck_tenant_module_requests_status
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE TABLE IF NOT EXISTS tenant_modules (
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    module_key     VARCHAR(60) NOT NULL REFERENCES module_catalog(module_key),
    status         VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    activated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_by   UUID,
    deactivated_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, module_key),
    CONSTRAINT ck_tenant_modules_status
        CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE TABLE IF NOT EXISTS platform_admins (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 VARCHAR(255) NOT NULL UNIQUE,
    name                  VARCHAR(255) NOT NULL,
    password_hash         VARCHAR(255) NOT NULL,
    is_active             BOOLEAN NOT NULL DEFAULT true,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_approval_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_id    UUID,
    action      VARCHAR(80) NOT NULL,
    old_status  VARCHAR(40),
    new_status  VARCHAR(40),
    note        TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_domains_subdomain ON tenant_domains(subdomain);
CREATE INDEX IF NOT EXISTS idx_tenant_module_requests_tenant ON tenant_module_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_modules_tenant ON tenant_modules(tenant_id, status);

INSERT INTO module_catalog (module_key, name, description, category, sort_order)
VALUES
    ('hrms', 'HRMS', 'Employee lifecycle, departments, branches, and staff management.', 'HRMS', 10),
    ('attendance', 'Attendance', 'Mobile punch in/out, geofence, live map, corrections, and logs.', 'HRMS', 20),
    ('leave', 'Leave', 'Leave balances, leave requests, manager approvals, and holidays.', 'HRMS', 30),
    ('crm', 'CRM', 'Sales leads, pipelines, customers, and follow-ups. Request-only placeholder.', 'Future', 90),
    ('accounts', 'Accounts', 'Invoices, payments, and accounting. Request-only placeholder.', 'Future', 100)
ON CONFLICT (module_key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

-- Default platform administrator for local smoke tests.
-- Email: admin@unifiedtree.com, password: Admin@123. Rotate before production.
INSERT INTO platform_admins (id, email, name, password_hash, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000101'::UUID,
    'admin@unifiedtree.com',
    'UnifiedTree Administrator',
    '$2a$10$mY8mTIEuqWEQyJIUKzsuX.ipY68JolYl1xQZjMxvg8e8LObYNZU96',
    true
)
ON CONFLICT (email) DO NOTHING;

-- Keep the existing local demo tenant usable after module gating is enabled.
INSERT INTO tenants (id, name, slug, status, admin_name, admin_email, admin_mobile, approved_at, approved_by)
VALUES (
    'aaaaaaaa-0000-0000-0000-000000000001'::UUID,
    'Demo Corp',
    'demo-corp',
    'ACTIVE',
    'Demo Admin',
    'admin@demo-corp.com',
    '9999999999',
    now(),
    '00000000-0000-0000-0000-000000000101'::UUID
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_domains (tenant_id, subdomain, full_domain, status)
VALUES (
    'aaaaaaaa-0000-0000-0000-000000000001'::UUID,
    'demo-corp',
    'demo-corp.unifiedtree.com',
    'ACTIVE'
)
ON CONFLICT (subdomain) DO NOTHING;

INSERT INTO tenant_module_requests (tenant_id, module_key, status, decided_at, decided_by)
VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001'::UUID, 'hrms', 'APPROVED', now(), '00000000-0000-0000-0000-000000000101'::UUID),
    ('aaaaaaaa-0000-0000-0000-000000000001'::UUID, 'attendance', 'APPROVED', now(), '00000000-0000-0000-0000-000000000101'::UUID),
    ('aaaaaaaa-0000-0000-0000-000000000001'::UUID, 'leave', 'APPROVED', now(), '00000000-0000-0000-0000-000000000101'::UUID)
ON CONFLICT (tenant_id, module_key) DO NOTHING;

INSERT INTO tenant_modules (tenant_id, module_key, status, activated_by)
VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001'::UUID, 'hrms', 'ACTIVE', '00000000-0000-0000-0000-000000000101'::UUID),
    ('aaaaaaaa-0000-0000-0000-000000000001'::UUID, 'attendance', 'ACTIVE', '00000000-0000-0000-0000-000000000101'::UUID),
    ('aaaaaaaa-0000-0000-0000-000000000001'::UUID, 'leave', 'ACTIVE', '00000000-0000-0000-0000-000000000101'::UUID)
ON CONFLICT (tenant_id, module_key) DO NOTHING;
