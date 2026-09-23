CREATE TABLE IF NOT EXISTS hrms.employee_onboarding_records (
 tenant_id UUID NOT NULL, employee_id UUID NOT NULL REFERENCES hrms.employees(id),
 details JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by UUID,
 PRIMARY KEY(tenant_id,employee_id)
);
ALTER TABLE hrms.employee_onboarding_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.employee_onboarding_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hrms.employee_onboarding_records;
CREATE POLICY tenant_isolation ON hrms.employee_onboarding_records
 USING(tenant_id=current_tenant_id()) WITH CHECK(tenant_id=current_tenant_id());
DO $$
DECLARE role_name TEXT;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['ut_app','hrms_app','app_user'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON hrms.employee_onboarding_records TO %I',role_name);
  END IF;
 END LOOP;
END $$;
