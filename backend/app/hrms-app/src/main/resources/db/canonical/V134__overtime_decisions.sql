CREATE TABLE attendance.overtime_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 record_id UUID NOT NULL UNIQUE, record_date DATE NOT NULL,
 FOREIGN KEY(record_id,record_date) REFERENCES attendance.records(id,attendance_date),
 status VARCHAR(16) NOT NULL CHECK(status IN ('APPROVED','REJECTED')),
 reviewed_minutes INTEGER NOT NULL CHECK(reviewed_minutes>0),
 decided_by UUID NOT NULL REFERENCES hrms.employees(id), note VARCHAR(1000),
 decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE attendance.overtime_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY overtime_decisions_tenant ON attendance.overtime_decisions USING(tenant_id=current_tenant_id()) WITH CHECK(tenant_id=current_tenant_id());
INSERT INTO rbac.permissions(code,display_name,module) VALUES ('attendance.overtime.approve','Approve team overtime','hrms') ON CONFLICT DO NOTHING;
INSERT INTO rbac.role_permissions(role_id,permission_code)
 SELECT id,'attendance.overtime.approve' FROM rbac.roles WHERE code IN ('OWNER','SUPER_ADMIN','COMPANY_ADMIN','ADMIN','HR_MANAGER','MANAGER','DEPT_MANAGER') ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hrms_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON attendance.overtime_decisions TO hrms_app;
 END IF;
END $$;
