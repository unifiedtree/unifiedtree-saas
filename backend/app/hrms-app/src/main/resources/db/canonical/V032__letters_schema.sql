-- =============================================================================
-- Letters module: templates + generated letters with tenant RLS
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS letters;

-- ── Templates ─────────────────────────────────────────────────────────────────

CREATE TABLE letters.templates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    company_id      UUID        NOT NULL,
    name            VARCHAR(200) NOT NULL,
    type            VARCHAR(40)  NOT NULL
                    CHECK (type IN ('OFFER','APPOINTMENT','RELIEVING','EXPERIENCE','SALARY_REVISION','CUSTOM')),
    subject         VARCHAR(500) NOT NULL,
    body_html       TEXT         NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    variant_name    VARCHAR(80),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    deleted_at      TIMESTAMPTZ,
    version         BIGINT       NOT NULL DEFAULT 0
);

CREATE INDEX idx_template_tenant_type
    ON letters.templates(tenant_id, type)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_template_name
    ON letters.templates(tenant_id, company_id, name)
    WHERE deleted_at IS NULL;

-- ── Generated letters ─────────────────────────────────────────────────────────

CREATE TABLE letters.generated (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID         NOT NULL,
    company_id           UUID         NOT NULL,
    template_id          UUID         NOT NULL REFERENCES letters.templates(id),
    employee_id          UUID         NOT NULL,
    type                 VARCHAR(40)  NOT NULL,
    subject              VARCHAR(500) NOT NULL,
    body_html_rendered   TEXT         NOT NULL,
    pdf_path             VARCHAR(1000),
    pdf_size_bytes       BIGINT,
    status               VARCHAR(20)  NOT NULL DEFAULT 'GENERATED'
                         CHECK (status IN ('GENERATED','SENT','VIEWED','SIGNED','VOID')),
    sent_at              TIMESTAMPTZ,
    sent_to_email        VARCHAR(320),
    viewed_at            TIMESTAMPTZ,
    signed_at            TIMESTAMPTZ,
    voided_at            TIMESTAMPTZ,
    voided_reason        VARCHAR(500),
    generated_by         UUID         NOT NULL,
    generation_context   JSONB,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by           VARCHAR(255),
    updated_by           VARCHAR(255),
    deleted_at           TIMESTAMPTZ,
    version              BIGINT       NOT NULL DEFAULT 0
);

CREATE INDEX idx_generated_employee
    ON letters.generated(tenant_id, employee_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_generated_template
    ON letters.generated(template_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_generated_status
    ON letters.generated(tenant_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE letters.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE letters.templates FORCE ROW LEVEL SECURITY;
CREATE POLICY templates_tenant_isolation ON letters.templates
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE letters.generated ENABLE ROW LEVEL SECURITY;
ALTER TABLE letters.generated FORCE ROW LEVEL SECURITY;
CREATE POLICY generated_tenant_isolation ON letters.generated
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Grants ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE ON SCHEMA letters TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.templates TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.generated TO app_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA letters TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.templates TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.generated TO hrms_app;
    END IF;
END $$;

DO $$ DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM information_schema.tables WHERE table_schema = 'letters';
    RAISE NOTICE 'letters schema tables created: %', c;
END $$;
