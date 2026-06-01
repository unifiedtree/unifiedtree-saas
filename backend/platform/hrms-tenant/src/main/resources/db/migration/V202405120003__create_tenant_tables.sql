-- V202405120003__create_tenant_tables.sql
-- Creates: companies, departments, branches tables for the hrms-tenant module

-- ============================================================
-- TABLE: companies
-- ============================================================
CREATE TABLE companies (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    name                VARCHAR(255) NOT NULL,
    domain              VARCHAR(255),
    logo_url            VARCHAR(512),
    subscription_tier   VARCHAR(50),
    max_employees       INT         NOT NULL DEFAULT 0,
    industry            VARCHAR(255),
    country             VARCHAR(100),
    timezone            VARCHAR(100),
    currency            VARCHAR(10)  NOT NULL DEFAULT 'INR',
    is_active           BOOLEAN      NOT NULL DEFAULT true,
    settings            JSONB,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_by          VARCHAR(255),
    updated_by          VARCHAR(255),
    version             BIGINT       NOT NULL DEFAULT 0,

    CONSTRAINT pk_companies PRIMARY KEY (id)
);

-- Unique domain per tenant
CREATE UNIQUE INDEX uq_companies_tenant_domain
    ON companies (tenant_id, domain)
    WHERE domain IS NOT NULL;

-- Standard indexes
CREATE INDEX idx_companies_tenant_id  ON companies (tenant_id);
CREATE INDEX idx_companies_is_active  ON companies (tenant_id, is_active);

-- ============================================================
-- TABLE: departments
-- ============================================================
CREATE TABLE departments (
    id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    tenant_id             UUID         NOT NULL,
    company_id            UUID         NOT NULL,
    name                  VARCHAR(255) NOT NULL,
    code                  VARCHAR(100),
    parent_department_id  UUID,
    head_employee_id      UUID,
    is_active             BOOLEAN      NOT NULL DEFAULT true,
    description           TEXT,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_by            VARCHAR(255),
    updated_by            VARCHAR(255),
    version               BIGINT       NOT NULL DEFAULT 0,

    CONSTRAINT pk_departments        PRIMARY KEY (id),
    CONSTRAINT fk_departments_company
        FOREIGN KEY (company_id) REFERENCES companies (id),
    CONSTRAINT fk_departments_parent
        FOREIGN KEY (parent_department_id) REFERENCES departments (id)
);

CREATE INDEX idx_departments_tenant_id    ON departments (tenant_id);
CREATE INDEX idx_departments_company_id   ON departments (company_id);
CREATE INDEX idx_departments_parent_id    ON departments (parent_department_id);

-- ============================================================
-- TABLE: branches
-- ============================================================
CREATE TABLE branches (
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    tenant_id                UUID         NOT NULL,
    company_id               UUID         NOT NULL,
    name                     VARCHAR(255) NOT NULL,
    code                     VARCHAR(100),
    address                  TEXT,
    city                     VARCHAR(100),
    state                    VARCHAR(100),
    country                  VARCHAR(100),
    pincode                  VARCHAR(20),
    latitude                 DOUBLE PRECISION,
    longitude                DOUBLE PRECISION,
    geo_fence_radius_meters  INT          NOT NULL DEFAULT 100,
    geo_fence_polygon        TEXT,
    is_headquarters          BOOLEAN      NOT NULL DEFAULT false,
    is_active                BOOLEAN      NOT NULL DEFAULT true,
    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_by               VARCHAR(255),
    updated_by               VARCHAR(255),
    version                  BIGINT       NOT NULL DEFAULT 0,

    CONSTRAINT pk_branches        PRIMARY KEY (id),
    CONSTRAINT fk_branches_company
        FOREIGN KEY (company_id) REFERENCES companies (id)
);

CREATE INDEX idx_branches_tenant_id   ON branches (tenant_id);
CREATE INDEX idx_branches_company_id  ON branches (company_id);
