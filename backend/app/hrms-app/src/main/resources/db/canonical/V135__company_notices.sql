CREATE TABLE hrms.company_notices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 company_id UUID NOT NULL REFERENCES org.companies(id), title VARCHAR(200) NOT NULL,
 body VARCHAR(5000) NOT NULL, expires_on DATE, archived BOOLEAN NOT NULL DEFAULT false,
 created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_notices_tenant_company ON hrms.company_notices(tenant_id,company_id,created_at DESC);
ALTER TABLE hrms.company_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_notices_tenant ON hrms.company_notices USING(tenant_id=current_tenant_id()) WITH CHECK(tenant_id=current_tenant_id());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hrms_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON hrms.company_notices TO hrms_app;
 END IF;
END $$;
