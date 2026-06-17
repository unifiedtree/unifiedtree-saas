-- =============================================================================
-- Bulk letter distribution: jobs + per-recipient rows, with tenant RLS.
--
-- Mirrors the V032 letters-schema conventions deliberately:
--   * tenant_id is a plain UUID NOT NULL — there is NO cross-schema FK to a
--     tenants table (no core.tenants exists; the canonical tenants table is
--     platform.tenants, and existing letters tables do not FK it). Tenant
--     isolation is enforced by RLS on app.tenant_id, exactly like letters.*.
--   * RLS: ENABLE + FORCE, policy USING + WITH CHECK on app.tenant_id.
--   * App-role grants guarded by pg_roles existence (app_user / hrms_app).
-- =============================================================================

CREATE TABLE letters.distribution_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    template_id      UUID NOT NULL REFERENCES letters.templates(id),
    title            VARCHAR(200) NOT NULL,
    custom_message   TEXT,
    subject_override VARCHAR(500),
    created_by       UUID NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    status           VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','PROCESSING','COMPLETED','PARTIAL_FAILURE','FAILED')),
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count       INTEGER NOT NULL DEFAULT 0,
    failed_count     INTEGER NOT NULL DEFAULT 0,
    completed_at     TIMESTAMPTZ
);

CREATE TABLE letters.distribution_recipients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    job_id              UUID NOT NULL REFERENCES letters.distribution_jobs(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL,
    generated_letter_id UUID REFERENCES letters.generated(id),  -- nullable until letter generated
    email               VARCHAR(320) NOT NULL,                  -- snapshotted at send time
    send_status         VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                        CHECK (send_status IN ('PENDING','GENERATING','SENT','FAILED','SKIPPED')),
    send_attempted_at   TIMESTAMPTZ,
    sent_at             TIMESTAMPTZ,
    error_message       TEXT,
    UNIQUE (job_id, employee_id)
);

CREATE INDEX idx_distribution_jobs_tenant_created
    ON letters.distribution_jobs(tenant_id, created_at DESC);
CREATE INDEX idx_distribution_recipients_job
    ON letters.distribution_recipients(job_id);
CREATE INDEX idx_distribution_recipients_pending
    ON letters.distribution_recipients(send_status)
    WHERE send_status IN ('PENDING','GENERATING');

-- ── RLS (mirror letters.templates / letters.generated in V032) ───────────────
ALTER TABLE letters.distribution_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE letters.distribution_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY distribution_jobs_tenant_isolation ON letters.distribution_jobs
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE letters.distribution_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE letters.distribution_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY distribution_recipients_tenant_isolation ON letters.distribution_recipients
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Grants (mirror V032) ─────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.distribution_jobs TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.distribution_recipients TO app_user;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.distribution_jobs TO hrms_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON letters.distribution_recipients TO hrms_app;
    END IF;
END $$;
