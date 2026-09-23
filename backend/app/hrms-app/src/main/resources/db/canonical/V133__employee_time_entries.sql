CREATE TABLE hrms.time_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 employee_id UUID NOT NULL REFERENCES hrms.employees(id), work_date DATE NOT NULL,
 description VARCHAR(1000) NOT NULL, minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 1440),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX time_entries_employee_date ON hrms.time_entries(tenant_id,employee_id,work_date);
ALTER TABLE hrms.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY time_entries_tenant ON hrms.time_entries USING(tenant_id=current_tenant_id()) WITH CHECK(tenant_id=current_tenant_id());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hrms_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON hrms.time_entries TO hrms_app;
 END IF;
END $$;
