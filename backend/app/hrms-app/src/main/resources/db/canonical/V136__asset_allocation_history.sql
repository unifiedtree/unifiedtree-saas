CREATE TABLE hrms.asset_allocations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 asset_id UUID NOT NULL REFERENCES hrms.onboarding_assets(id), employee_id UUID NOT NULL REFERENCES hrms.employees(id),
 assigned_at DATE NOT NULL, returned_at DATE, return_notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT asset_allocation_dates CHECK(returned_at IS NULL OR returned_at>=assigned_at)
);
CREATE INDEX asset_allocations_history ON hrms.asset_allocations(tenant_id,asset_id,created_at DESC);
CREATE UNIQUE INDEX asset_one_open_allocation ON hrms.asset_allocations(asset_id) WHERE returned_at IS NULL;
INSERT INTO hrms.asset_allocations(tenant_id,asset_id,employee_id,assigned_at,returned_at,return_notes)
 SELECT tenant_id,id,employee_id,assigned_at,returned_at,condition_notes FROM hrms.onboarding_assets
 WHERE employee_id IS NOT NULL AND assigned_at IS NOT NULL;
ALTER TABLE hrms.asset_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_allocations_tenant ON hrms.asset_allocations USING(tenant_id=current_tenant_id()) WITH CHECK(tenant_id=current_tenant_id());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hrms_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON hrms.asset_allocations TO hrms_app;
 END IF;
END $$;
