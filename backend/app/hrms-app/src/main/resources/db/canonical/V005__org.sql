-- ============================================================================
-- V005 - org schema: companies, branches, geofence zones
-- ============================================================================
-- Tenant-owned. RLS on. One tenant can have multiple companies (group structure)
-- and each company has branches. Branch is the unit of geofencing for attendance.
-- ============================================================================

CREATE TABLE org.companies (
    id                  UUID            PRIMARY KEY,
    tenant_id           UUID            NOT NULL,
    name                VARCHAR(150)    NOT NULL,
    legal_name          VARCHAR(200),
    registration_number VARCHAR(50),
    pan_number          VARCHAR(15),
    gstin               VARCHAR(20),
    industry            VARCHAR(50),
    country             VARCHAR(50)     DEFAULT 'India',
    timezone            VARCHAR(50)     DEFAULT 'Asia/Kolkata',
    currency            VARCHAR(10)     DEFAULT 'INR',
    fiscal_year_start   VARCHAR(10)     DEFAULT 'APRIL',     -- APRIL | JANUARY
    logo_url            VARCHAR(500),
    employee_count_cached INT           DEFAULT 0,           -- denormalized for dashboard speed
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_company_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_companies_tenant ON org.companies(tenant_id);

ALTER TABLE org.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_companies ON org.companies
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
CREATE TABLE org.branches (
    id                          UUID            PRIMARY KEY,
    tenant_id                   UUID            NOT NULL,
    company_id                  UUID            NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    name                        VARCHAR(150)    NOT NULL,
    code                        VARCHAR(30),
    address_line                VARCHAR(255),
    city                        VARCHAR(100),
    state                       VARCHAR(100),
    country                     VARCHAR(50)     DEFAULT 'India',
    pincode                     VARCHAR(15),
    latitude                    DECIMAL(10,7),
    longitude                   DECIMAL(10,7),
    geo_fence_radius_meters     INT             DEFAULT 500,
    geo_fence_enforced          BOOLEAN         NOT NULL DEFAULT FALSE,
    manager_employee_id         UUID,
    employee_count_cached       INT             DEFAULT 0,
    is_headquarters             BOOLEAN         NOT NULL DEFAULT FALSE,
    is_active                   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_branches_tenant ON org.branches(tenant_id);
CREATE INDEX idx_branches_company ON org.branches(tenant_id, company_id);

ALTER TABLE org.branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_branches ON org.branches
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Additional geofence zones beyond the branch's primary geofence (e.g. client
-- site for field staff). The attendance service checks all overlapping zones.
-- ----------------------------------------------------------------------------
CREATE TABLE org.geofence_zones (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    company_id      UUID            NOT NULL REFERENCES org.companies(id) ON DELETE CASCADE,
    branch_id       UUID            REFERENCES org.branches(id) ON DELETE SET NULL,
    zone_name       VARCHAR(150)    NOT NULL,
    latitude        DECIMAL(10,7)   NOT NULL,
    longitude       DECIMAL(10,7)   NOT NULL,
    radius_meters   INT             NOT NULL DEFAULT 200,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_geofence_zones_tenant ON org.geofence_zones(tenant_id);
CREATE INDEX idx_geofence_zones_branch ON org.geofence_zones(tenant_id, branch_id);

ALTER TABLE org.geofence_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_geofence ON org.geofence_zones
    USING (tenant_id = current_tenant_id());
