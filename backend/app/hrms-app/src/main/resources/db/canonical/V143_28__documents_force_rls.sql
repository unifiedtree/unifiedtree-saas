-- V143.28: force row-level security on the document tables.
--
-- document_mgmt.employee_documents and document_mgmt.document_types have RLS
-- policies (tenant_id = current_tenant_id()) but weren't FORCEd, so the tables'
-- owner bypassed them. The app connects as ut_app (not the owner), so it was
-- already isolated; the review queue's SQL relies on that and has no tenant
-- filter of its own. Forcing it means that stays true even for a session
-- connected as the owner, as most tenant tables already are (letters,
-- settings, rbac…).
--
-- No effect on the app's connections (ut_app is subject to RLS either way) or
-- on superusers (they bypass RLS). Idempotent.

DO $$
BEGIN
    IF to_regclass('document_mgmt.employee_documents') IS NOT NULL THEN
        ALTER TABLE document_mgmt.employee_documents ENABLE ROW LEVEL SECURITY;
        ALTER TABLE document_mgmt.employee_documents FORCE ROW LEVEL SECURITY;
    END IF;
    IF to_regclass('document_mgmt.document_types') IS NOT NULL THEN
        ALTER TABLE document_mgmt.document_types ENABLE ROW LEVEL SECURITY;
        ALTER TABLE document_mgmt.document_types FORCE ROW LEVEL SECURITY;
    END IF;
END $$;
