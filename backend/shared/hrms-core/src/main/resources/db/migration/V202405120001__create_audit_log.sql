-- Immutable audit log shared across all modules.
-- Never delete rows from this table; retention enforced by partition pruning after 7 years.
CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    actor_id        VARCHAR(255) NOT NULL,
    actor_role      VARCHAR(50)  NOT NULL,
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(100) NOT NULL,
    resource_id     VARCHAR(255),
    old_value       JSONB,
    new_value       JSONB,
    ip_address      INET,
    user_agent      TEXT,
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    checksum        VARCHAR(64)  NOT NULL
);

CREATE INDEX idx_audit_log_tenant_id    ON audit_log (tenant_id);
CREATE INDEX idx_audit_log_actor_id     ON audit_log (actor_id);
CREATE INDEX idx_audit_log_resource     ON audit_log (resource_type, resource_id);
CREATE INDEX idx_audit_log_occurred_at  ON audit_log (occurred_at DESC);

COMMENT ON TABLE audit_log IS 'Tamper-evident immutable audit trail. checksum = SHA-256 of (tenant_id|actor_id|action|resource_type|resource_id|occurred_at).';
