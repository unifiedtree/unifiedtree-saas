-- =============================================================================
-- MODULE: hrms-tenant
-- Tables: companies, departments, branches
-- Purpose: Multi-tenant organisation hierarchy.
--          tenant_id = top-level isolation key (one per SaaS customer).
--          company_id = the specific legal entity within a tenant.
--          A tenant may own multiple companies (e.g., group companies).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: companies
-- Root entity for a tenant's organisation. All other domain records reference
-- company_id for per-company data isolation.
--
-- subscription_tier: STARTER | GROWTH | ENTERPRISE
-- settings: arbitrary JSONB config (leave policies override, branding, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE companies (
    id                UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    name              VARCHAR(255)  NOT NULL,
    domain            VARCHAR(255),                          -- unique per tenant
    logo_url          VARCHAR(512),
    subscription_tier VARCHAR(50),                           -- STARTER | GROWTH | ENTERPRISE
    max_employees     INT           NOT NULL DEFAULT 0,      -- 0 = unlimited
    industry          VARCHAR(255),
    country           VARCHAR(100),
    timezone          VARCHAR(100),                          -- IANA tz, e.g. Asia/Kolkata
    currency          VARCHAR(10)   NOT NULL DEFAULT 'INR',
    is_active         BOOLEAN       NOT NULL DEFAULT true,
    settings          JSONB,                                 -- free-form config blob
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT pk_companies PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_tenant_domain
    ON companies (tenant_id, domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_tenant_id ON companies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_companies_is_active ON companies (tenant_id, is_active);

COMMENT ON COLUMN companies.settings IS 'Arbitrary JSONB config: branding, policy overrides, feature flags.';
COMMENT ON COLUMN companies.max_employees IS '0 means unlimited (Enterprise tier).';

-- -----------------------------------------------------------------------------
-- TABLE: departments
-- Supports unlimited-depth hierarchy via parent_department_id self-reference.
-- head_employee_id is a logical FK to employees.id (not enforced in DB).
-- -----------------------------------------------------------------------------
CREATE TABLE departments (
    id                   UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id            UUID          NOT NULL,
    company_id           UUID          NOT NULL REFERENCES companies(id),
    name                 VARCHAR(255)  NOT NULL,
    code                 VARCHAR(100),
    parent_department_id UUID          REFERENCES departments(id),  -- NULL = root dept
    head_employee_id     UUID,                                       -- → employees.id (logical FK)
    is_active            BOOLEAN       NOT NULL DEFAULT true,
    description          TEXT,
    color_hex            VARCHAR(20),
    icon_key             VARCHAR(50),
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by           VARCHAR(255),
    updated_by           VARCHAR(255),
    version              BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT pk_departments PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_departments_tenant_id   ON departments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_departments_company_id  ON departments (company_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent_id   ON departments (parent_department_id);

COMMENT ON COLUMN departments.parent_department_id IS 'NULL for root departments. Supports unlimited tree depth.';
COMMENT ON COLUMN departments.head_employee_id     IS 'Logical FK to employees.id; not enforced to avoid cross-module constraint.';

-- -----------------------------------------------------------------------------
-- TABLE: branches
-- Physical office locations. geo_fence_radius_meters + latitude/longitude used
-- for geo-attendance check-in validation in hrms-attendance.
-- geo_fence_polygon: WKT or GeoJSON string for complex non-circular zones.
-- -----------------------------------------------------------------------------
CREATE TABLE branches (
    id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    company_id              UUID          NOT NULL REFERENCES companies(id),
    name                    VARCHAR(255)  NOT NULL,
    code                    VARCHAR(100),
    address                 TEXT,
    city                    VARCHAR(100),
    state                   VARCHAR(100),
    country                 VARCHAR(100),
    pincode                 VARCHAR(20),
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,
    geo_fence_radius_meters INT           NOT NULL DEFAULT 100,  -- metres from lat/lng centre
    geo_fence_polygon       TEXT,                                -- WKT/GeoJSON for irregular zones
    color_hex               VARCHAR(20),
    icon_key                VARCHAR(50),
    is_headquarters         BOOLEAN       NOT NULL DEFAULT false,
    is_active               BOOLEAN       NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by              VARCHAR(255),
    updated_by              VARCHAR(255),
    version                 BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT pk_branches PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant_id  ON branches (tenant_id);
CREATE INDEX IF NOT EXISTS idx_branches_company_id ON branches (company_id);

COMMENT ON COLUMN branches.geo_fence_radius_meters IS 'Circular geofence radius. Overridden by geo_fence_polygon when set.';
COMMENT ON COLUMN branches.geo_fence_polygon       IS 'WKT POLYGON or GeoJSON string for non-circular geofence boundaries.';
