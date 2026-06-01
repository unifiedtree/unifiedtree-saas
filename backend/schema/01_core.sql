-- =============================================================================
-- MODULE: hrms-core
-- Tables: audit_log
-- Purpose: Tamper-evident immutable audit trail shared across all modules.
--          Every state-changing operation in the platform writes a row here.
-- =============================================================================

-- Checksum = SHA-256( tenant_id | actor_id | action | resource_type | resource_id | occurred_at )
-- Never UPDATE or DELETE rows. Retention enforced by partition pruning after 7 years.

CREATE TABLE IF NOT EXISTS audit_log (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    actor_id      VARCHAR(255)  NOT NULL,                 -- user_credentials.id (as string)
    actor_role    VARCHAR(50)   NOT NULL,                 -- role at time of action
    action        VARCHAR(100)  NOT NULL,                 -- e.g. CREATE, UPDATE, DELETE, LOGIN
    resource_type VARCHAR(100)  NOT NULL,                 -- e.g. Employee, LeaveRequest
    resource_id   VARCHAR(255),                           -- UUID of affected record
    old_value     JSONB,                                  -- snapshot before change
    new_value     JSONB,                                  -- snapshot after change
    ip_address    INET,
    user_agent    TEXT,
    occurred_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    checksum      VARCHAR(64)   NOT NULL                  -- SHA-256 hex for tamper detection
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id   ON audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id    ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource    ON audit_log (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log (occurred_at DESC);

COMMENT ON TABLE  audit_log              IS 'Tamper-evident audit trail. Never mutate rows.';
COMMENT ON COLUMN audit_log.checksum     IS 'SHA-256 of (tenant_id|actor_id|action|resource_type|resource_id|occurred_at)';
COMMENT ON COLUMN audit_log.old_value    IS 'Full entity snapshot before the change (nullable for CREATE)';
COMMENT ON COLUMN audit_log.new_value    IS 'Full entity snapshot after the change (nullable for DELETE)';
