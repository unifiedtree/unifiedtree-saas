CREATE TABLE compliance_mgmt.inspection_documents (
 id UUID PRIMARY KEY, tenant_id UUID NOT NULL, session_id UUID NOT NULL REFERENCES compliance_mgmt.inspector_sessions(id),
 title VARCHAR(200) NOT NULL, storage_kind VARCHAR(10) NOT NULL CHECK(storage_kind IN ('LOCAL','R2')),
 size_bytes BIGINT NOT NULL CHECK(size_bytes>0 AND size_bytes<=5242880), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inspection_documents_session ON compliance_mgmt.inspection_documents(tenant_id,session_id);
ALTER TABLE compliance_mgmt.inspection_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY inspection_documents_tenant ON compliance_mgmt.inspection_documents USING(tenant_id=current_tenant_id()) WITH CHECK(tenant_id=current_tenant_id());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hrms_app') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON compliance_mgmt.inspection_documents TO hrms_app;
END IF; END $$;
