-- ============================================================================
-- V002 - platform schema: tenants, domains, module catalog, tenant modules
-- ============================================================================
-- RLS is intentionally NOT enabled on platform.* tables.
-- These rows are managed by the UnifiedTree administrator (super-admin
-- workspace) and are queried with SECURITY DEFINER service code, never via
-- the tenant-scoped HTTP path.
-- ============================================================================

CREATE TABLE platform.tenants (
    id                  UUID                       PRIMARY KEY,
    subdomain           VARCHAR(63)                NOT NULL UNIQUE,
    display_name        VARCHAR(150)               NOT NULL,
    contact_email       VARCHAR(255),
    contact_phone       VARCHAR(20),
    status              platform.tenant_status     NOT NULL DEFAULT 'PENDING_APPROVAL',
    plan_type           platform.plan_tier         NOT NULL DEFAULT 'STARTER',
    region              VARCHAR(20)                NOT NULL DEFAULT 'in',
    requested_modules   TEXT[],
    notes               TEXT,
    created_at          TIMESTAMPTZ                NOT NULL DEFAULT now(),
    approved_at         TIMESTAMPTZ,
    approved_by         UUID,
    suspended_at        TIMESTAMPTZ,
    terminated_at       TIMESTAMPTZ
);

COMMENT ON TABLE platform.tenants IS 'One row per company workspace. Owns subdomain + lifecycle state.';

CREATE INDEX idx_tenants_status ON platform.tenants(status);
CREATE INDEX idx_tenants_subdomain ON platform.tenants(subdomain);

-- ----------------------------------------------------------------------------
CREATE TABLE platform.tenant_domains (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    domain          VARCHAR(255)    NOT NULL UNIQUE,
    is_primary      BOOLEAN         NOT NULL DEFAULT FALSE,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_domains_tenant ON platform.tenant_domains(tenant_id);

-- ----------------------------------------------------------------------------
CREATE TABLE platform.module_catalog (
    key                 VARCHAR(50)    PRIMARY KEY,
    display_name        VARCHAR(100)   NOT NULL,
    description         TEXT,
    category            VARCHAR(50),
    base_price_inr      NUMERIC(12,2),
    per_seat_price_inr  NUMERIC(12,2),
    is_available        BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform.module_catalog IS
    'Master list of modules that can be sold (hrms, attendance, leave, crm, ...).';

-- ----------------------------------------------------------------------------
CREATE TABLE platform.tenant_modules (
    id              UUID                       PRIMARY KEY,
    tenant_id       UUID                       NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    module_key      VARCHAR(50)                NOT NULL REFERENCES platform.module_catalog(key),
    status          platform.module_status     NOT NULL DEFAULT 'REQUESTED',
    requested_at    TIMESTAMPTZ                NOT NULL DEFAULT now(),
    approved_at     TIMESTAMPTZ,
    approved_by     UUID,
    activated_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    UNIQUE (tenant_id, module_key)
);

CREATE INDEX idx_tenant_modules_tenant ON platform.tenant_modules(tenant_id);
CREATE INDEX idx_tenant_modules_status ON platform.tenant_modules(status);

-- ----------------------------------------------------------------------------
-- Seed the module catalog. Edit as new modules are productized.
-- ----------------------------------------------------------------------------
INSERT INTO platform.module_catalog (key, display_name, category, base_price_inr, is_available) VALUES
    ('hrms',         'HRMS - Workforce Directory',       'Core HR',     0,    TRUE),
    ('attendance',   'Attendance & Time',                'Core HR',     0,    TRUE),
    ('leave',        'Leave Management',                 'Core HR',     0,    TRUE),
    ('payroll',      'Payroll & Compensation',           'Finance',     NULL, FALSE),
    ('recruitment',  'Recruitment & Onboarding',         'Talent',      NULL, FALSE),
    ('performance',  'Performance & Appraisals',         'Talent',      NULL, FALSE),
    ('learning',     'Training & Certifications',        'Talent',      NULL, FALSE),
    ('expense',      'Expense Management',               'Finance',     NULL, FALSE),
    ('compliance',   'Statutory Compliance',             'Compliance',  NULL, FALSE),
    ('crm',          'CRM - Leads, Deals, Customers',    'Sales',       NULL, FALSE),
    ('accounts',     'Accounts - Invoices, Payments',    'Finance',     NULL, FALSE)
ON CONFLICT (key) DO NOTHING;
