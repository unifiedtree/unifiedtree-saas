CREATE TABLE hrms.projects (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 company_id UUID NOT NULL REFERENCES org.companies(id), name VARCHAR(200) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','CANCELLED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hrms.project_tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 project_id UUID NOT NULL REFERENCES hrms.projects(id), title VARCHAR(300) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','IN_PROGRESS','DONE')),
 due_date DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE INDEX idx_project_tenant_company ON hrms.projects(tenant_id,company_id);
CREATE INDEX idx_project_tasks_tenant_project ON hrms.project_tasks(tenant_id,project_id);
ALTER TABLE hrms.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant ON hrms.projects USING(tenant_id = current_tenant_id()) WITH CHECK(tenant_id = current_tenant_id());
CREATE POLICY project_tasks_tenant ON hrms.project_tasks USING(tenant_id = current_tenant_id()) WITH CHECK(tenant_id = current_tenant_id());
INSERT INTO rbac.permissions(code,display_name,module) VALUES
 ('hrms.project.read','View company projects and tasks','hrms'),
 ('hrms.project.write','Manage company projects and tasks','hrms') ON CONFLICT DO NOTHING;
INSERT INTO rbac.role_permissions(role_id,permission_code)
 SELECT r.id,p.code FROM rbac.roles r CROSS JOIN rbac.permissions p
 WHERE r.code IN ('OWNER','SUPER_ADMIN','COMPANY_ADMIN','ADMIN','HR_MANAGER')
 AND p.code IN ('hrms.project.read','hrms.project.write') ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hrms_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON hrms.projects,hrms.project_tasks TO hrms_app;
 END IF;
END $$;
