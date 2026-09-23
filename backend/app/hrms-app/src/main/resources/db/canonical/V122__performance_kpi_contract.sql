-- Complete the existing KPI API contract. V071 created basic goals but the
-- KPI service also reads numeric targets and a progress history table.
ALTER TABLE performance_mgmt.goals
    ADD COLUMN IF NOT EXISTS category VARCHAR(40),
    ADD COLUMN IF NOT EXISTS target_value NUMERIC(20,4),
    ADD COLUMN IF NOT EXISTS current_value NUMERIC(20,4),
    ADD COLUMN IF NOT EXISTS unit VARCHAR(24),
    ADD COLUMN IF NOT EXISTS direction VARCHAR(30),
    ADD COLUMN IF NOT EXISTS due_date DATE;

ALTER TABLE performance_mgmt.goals ALTER COLUMN title TYPE VARCHAR(300);

CREATE TABLE IF NOT EXISTS performance_mgmt.kpi_progress_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    goal_id UUID NOT NULL REFERENCES performance_mgmt.goals(id) ON DELETE CASCADE,
    previous_value NUMERIC(20,4),
    new_value NUMERIC(20,4) NOT NULL,
    progress_pct NUMERIC(8,2) NOT NULL DEFAULT 0,
    notes TEXT,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kpi_progress_tenant_goal
    ON performance_mgmt.kpi_progress_updates(tenant_id, goal_id, updated_at DESC);
ALTER TABLE performance_mgmt.kpi_progress_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_mgmt.kpi_progress_updates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_kpi_progress ON performance_mgmt.kpi_progress_updates;
CREATE POLICY tenant_isolation_kpi_progress ON performance_mgmt.kpi_progress_updates
    USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

DO $$
DECLARE app_role TEXT;
BEGIN
    FOREACH app_role IN ARRAY ARRAY['ut_app', 'hrms_app', 'app_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
            EXECUTE format('GRANT USAGE ON SCHEMA performance_mgmt TO %I', app_role);
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON performance_mgmt.kpi_progress_updates TO %I', app_role);
        END IF;
    END LOOP;
END $$;
