-- ============================================================================
-- V010 - audit schema: append-only audit trail (PARTITIONED)
-- ============================================================================
-- Every write across the platform emits one row here. Rows are immutable.
-- Partitioned monthly so old data can be dropped (compliance retention is
-- typically 12 months; archive older to cold storage).
-- ============================================================================

CREATE TABLE audit.events (
    id              UUID            NOT NULL,
    tenant_id       UUID,
    occurred_at     TIMESTAMPTZ     NOT NULL,
    occurred_date   DATE            NOT NULL,
    actor_user_id   UUID,
    actor_email     VARCHAR(255),
    actor_ip        INET,
    actor_user_agent VARCHAR(500),
    module          VARCHAR(50)     NOT NULL,        -- hrms, attendance, leave, rbac, ...
    action          VARCHAR(50)     NOT NULL,        -- CREATE, UPDATE, DELETE, LOGIN, EXPORT, APPROVE
    entity_type     VARCHAR(100),
    entity_id       UUID,
    summary         TEXT,
    diff            JSONB,
    request_id      VARCHAR(64),
    correlation_id  VARCHAR(64),
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_audit_tenant_date ON audit.events (tenant_id, occurred_date);
CREATE INDEX idx_audit_actor ON audit.events (tenant_id, actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_entity ON audit.events (tenant_id, entity_type, entity_id);
CREATE INDEX idx_audit_module_action ON audit.events (tenant_id, module, action, occurred_at DESC);

-- Audit is NOT RLS-isolated at the row level: the audit reader endpoint applies
-- tenant_id filtering in the service layer with super-admin-only escape hatch
-- for the platform owner. Keeping RLS off avoids accidentally hiding events
-- from compliance auditors who span tenants.

-- Initial partitions
CREATE TABLE audit.events_2026_05 PARTITION OF audit.events FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit.events_2026_06 PARTITION OF audit.events FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit.events_2026_07 PARTITION OF audit.events FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit.events_2026_08 PARTITION OF audit.events FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit.events_default PARTITION OF audit.events DEFAULT;

CREATE OR REPLACE FUNCTION audit.ensure_monthly_partition(p_year INT, p_month INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    partition_name TEXT;
    range_start    DATE;
    range_end      DATE;
BEGIN
    range_start := make_date(p_year, p_month, 1);
    range_end := range_start + INTERVAL '1 month';
    partition_name := format('events_%s_%s', p_year, lpad(p_month::TEXT, 2, '0'));
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS audit.%I PARTITION OF audit.events FOR VALUES FROM (%L) TO (%L)',
        partition_name, range_start::TIMESTAMPTZ, range_end::TIMESTAMPTZ
    );
END;
$$;
