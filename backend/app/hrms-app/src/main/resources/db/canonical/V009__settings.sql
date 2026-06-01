-- ============================================================================
-- V009 - settings schema: HR configuration, holiday calendar, notification templates
-- ============================================================================

CREATE TABLE settings.hr_configuration (
    id                              UUID            PRIMARY KEY,
    tenant_id                       UUID            NOT NULL,
    company_id                      UUID            NOT NULL,
    fiscal_year_start               VARCHAR(10)     DEFAULT 'APRIL',    -- APRIL | JANUARY
    default_notice_period_days      INT             DEFAULT 60,
    probation_period_months         INT             DEFAULT 6,
    retirement_age                  INT             DEFAULT 60,
    enable_late_auto_deduction      BOOLEAN         NOT NULL DEFAULT FALSE,
    late_grace_minutes              INT             DEFAULT 15,
    enforce_geofencing_for_mobile   BOOLEAN         NOT NULL DEFAULT TRUE,
    allow_work_from_home            BOOLEAN         NOT NULL DEFAULT TRUE,
    workweek_start_day              INT             DEFAULT 1,           -- ISO: 1=Mon
    weekend_days                    INT[]           DEFAULT ARRAY[6,7],  -- Sat, Sun
    created_at                      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT uq_hr_config_per_company UNIQUE (tenant_id, company_id)
);

CREATE INDEX idx_hr_config_tenant ON settings.hr_configuration(tenant_id);
ALTER TABLE settings.hr_configuration ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_hr_config ON settings.hr_configuration
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE settings.holiday_type AS ENUM ('NATIONAL','FESTIVAL','RESTRICTED','REGIONAL','OPTIONAL','COMPANY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE settings.holiday_calendar (
    id              UUID                        PRIMARY KEY,
    tenant_id       UUID                        NOT NULL,
    company_id      UUID                        NOT NULL,
    year            INT                         NOT NULL,
    holiday_date    DATE                        NOT NULL,
    holiday_name    VARCHAR(150)                NOT NULL,
    holiday_type    settings.holiday_type       NOT NULL DEFAULT 'COMPANY',
    description     TEXT,
    is_active       BOOLEAN                     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

CREATE INDEX idx_holidays_tenant_year ON settings.holiday_calendar(tenant_id, year);
CREATE INDEX idx_holidays_date ON settings.holiday_calendar(tenant_id, holiday_date);

ALTER TABLE settings.holiday_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_holidays ON settings.holiday_calendar
    USING (tenant_id = current_tenant_id());

-- Holidays can be scoped to specific branches (many-to-many; empty = all branches)
CREATE TABLE settings.holiday_branches (
    tenant_id   UUID    NOT NULL,
    holiday_id  UUID    NOT NULL REFERENCES settings.holiday_calendar(id) ON DELETE CASCADE,
    branch_id   UUID    NOT NULL,
    PRIMARY KEY (holiday_id, branch_id)
);

ALTER TABLE settings.holiday_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_holiday_branches ON settings.holiday_branches
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Notification templates (per client spec - Leaves, Payroll, Onboarding categories)
DO $$ BEGIN
    CREATE TYPE settings.notification_channel AS ENUM ('EMAIL','PUSH','SMS','WHATSAPP','IN_APP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE settings.notification_templates (
    id                  UUID                            PRIMARY KEY,
    tenant_id           UUID                            NOT NULL,
    template_key        VARCHAR(100)                    NOT NULL,   -- LEAVE_APPROVAL_REQUEST, LEAVE_APPROVED, etc.
    category            VARCHAR(50)                     NOT NULL,   -- LEAVES, PAYROLL, ONBOARDING
    display_name        VARCHAR(150)                    NOT NULL,
    email_subject       VARCHAR(255),
    email_body          TEXT,
    push_title          VARCHAR(150),
    push_body           TEXT,
    enabled_channels    settings.notification_channel[] NOT NULL DEFAULT ARRAY['EMAIL','PUSH']::settings.notification_channel[],
    is_active           BOOLEAN                         NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ                     NOT NULL DEFAULT now(),

    CONSTRAINT uq_notif_template_tenant_key UNIQUE (tenant_id, template_key)
);

CREATE INDEX idx_notif_templates_tenant ON settings.notification_templates(tenant_id);
ALTER TABLE settings.notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notif_templates ON settings.notification_templates
    USING (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- Integrations registry
CREATE TABLE settings.integrations (
    id              UUID            PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    integration_key VARCHAR(50)     NOT NULL,    -- google_workspace, slack, biometric_essl, jira, etc.
    display_name    VARCHAR(100)    NOT NULL,
    status          VARCHAR(20)     NOT NULL DEFAULT 'INACTIVE',  -- ACTIVE | INACTIVE
    config          JSONB           NOT NULL DEFAULT '{}'::JSONB,
    connected_at    TIMESTAMPTZ,
    connected_by    UUID,

    CONSTRAINT uq_integration_tenant_key UNIQUE (tenant_id, integration_key)
);

CREATE INDEX idx_integrations_tenant ON settings.integrations(tenant_id);
ALTER TABLE settings.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_integrations ON settings.integrations
    USING (tenant_id = current_tenant_id());
