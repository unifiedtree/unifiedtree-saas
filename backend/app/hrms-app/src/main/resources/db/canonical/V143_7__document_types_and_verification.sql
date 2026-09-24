-- V143.7 — configurable document types + verification workflow.
--
-- The employee vault (V072) had 7 generic categories (CONTRACT, ID_PROOF, …)
-- and nothing else: no per-type format/size rules, no HR verification, no
-- required-on-onboarding flag. Real HRMS parity (Zoho / Odoo) needs:
--   * admin-configurable named types (Aadhaar, PAN, Passport, …) with rules
--   * upload → PENDING → HR VERIFIED / REJECTED workflow
--   * per-type max size (default 5 MB), allowed formats, required flag,
--     expiry-tracked flag
--
-- Numbered 143.7 so it cannot collide with a teammate's V144. Idempotent.

-- ── 1. document_types (admin-configurable, per tenant) ─────────────────────
CREATE TABLE IF NOT EXISTS document_mgmt.document_types (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    code              VARCHAR(50)   NOT NULL,     -- e.g. 'AADHAAR'
    display_name      VARCHAR(120)  NOT NULL,     -- e.g. 'Aadhaar Card'
    description       TEXT,
    -- Comma-separated lowercase extensions with no dots, e.g. 'pdf,jpg,png'.
    -- Server splits and compares case-insensitively.
    allowed_formats   VARCHAR(200)  NOT NULL DEFAULT 'pdf,jpg,jpeg,png',
    max_size_mb       INT           NOT NULL DEFAULT 5,
    required          BOOLEAN       NOT NULL DEFAULT FALSE,
    expiry_tracked    BOOLEAN       NOT NULL DEFAULT FALSE,
    active            BOOLEAN       NOT NULL DEFAULT TRUE,
    sort_order        INT           NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        VARCHAR(255),
    updated_by        VARCHAR(255),
    version           BIGINT        NOT NULL DEFAULT 0,
    CONSTRAINT ck_doc_type_size CHECK (max_size_mb BETWEEN 1 AND 50),
    CONSTRAINT ck_doc_type_code CHECK (code ~ '^[A-Z0-9_]{2,50}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_types_tenant_code
    ON document_mgmt.document_types (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_doc_types_tenant_active
    ON document_mgmt.document_types (tenant_id, active, sort_order);

ALTER TABLE document_mgmt.document_types ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname='document_mgmt' AND tablename='document_types'
           AND policyname='tenant_isolation_doctypes') THEN
        CREATE POLICY tenant_isolation_doctypes ON document_mgmt.document_types
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. Extend employee_documents with verification + typed metadata ────────
ALTER TABLE document_mgmt.employee_documents
    ADD COLUMN IF NOT EXISTS document_type_id     UUID,
    ADD COLUMN IF NOT EXISTS verification_status  VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS verified_by          UUID,
    ADD COLUMN IF NOT EXISTS verified_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason     TEXT,
    ADD COLUMN IF NOT EXISTS original_filename    VARCHAR(300),
    ADD COLUMN IF NOT EXISTS file_size_bytes      BIGINT,
    ADD COLUMN IF NOT EXISTS content_type         VARCHAR(100);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
         WHERE constraint_schema='document_mgmt'
           AND constraint_name='ck_emp_doc_verification_status') THEN
        ALTER TABLE document_mgmt.employee_documents
            ADD CONSTRAINT ck_emp_doc_verification_status
            CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_documents_type
    ON document_mgmt.employee_documents (tenant_id, document_type_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_employee_documents_pending_verification
    ON document_mgmt.employee_documents (tenant_id, verification_status)
    WHERE verification_status = 'PENDING';

-- ── 3. Seed default document types for each existing tenant ────────────────
-- One INSERT per default; idempotent via UNIQUE (tenant_id, code). Every
-- tenant that exists in platform.tenants gets the same 10 defaults so an
-- employee can start uploading day one. Admin can then rename/reorder/disable.
INSERT INTO document_mgmt.document_types
    (tenant_id, code, display_name, description, allowed_formats, max_size_mb, required, expiry_tracked, sort_order)
SELECT t.id, d.code, d.display_name, d.description, d.allowed_formats, d.max_size_mb, d.required, d.expiry_tracked, d.sort_order
FROM platform.tenants t
CROSS JOIN (VALUES
    ('AADHAAR',        'Aadhaar Card',            'Government-issued Indian ID.',                'pdf,jpg,jpeg,png', 5,  TRUE,  FALSE, 10),
    ('PAN',            'PAN Card',                'Permanent Account Number card (required for payroll).', 'pdf,jpg,jpeg,png', 5,  TRUE,  FALSE, 20),
    ('PASSPORT',       'Passport',                'Only if you have one — expiry is tracked.',    'pdf,jpg,jpeg,png', 5,  FALSE, TRUE,  30),
    ('DRIVING_LICENSE','Driving License',         'Only if you have one — expiry is tracked.',    'pdf,jpg,jpeg,png', 5,  FALSE, TRUE,  40),
    ('VOTER_ID',       'Voter ID',                'EPIC / Voter ID card.',                        'pdf,jpg,jpeg,png', 5,  FALSE, FALSE, 50),
    ('PHOTO',          'Passport-size Photograph','Recent passport-size photo for your profile.', 'jpg,jpeg,png',     2,  TRUE,  FALSE, 60),
    ('RESUME',         'Resume / CV',             'Your latest resume.',                           'pdf',              5,  TRUE,  FALSE, 70),
    ('EDUCATION_CERT', 'Educational Certificate', '10th, 12th, degree or diploma certificates.', 'pdf,jpg,jpeg,png',10,  FALSE, FALSE, 80),
    ('OFFER_LETTER',   'Offer Letter',            'Signed offer letter or appointment letter.',   'pdf',              5,  FALSE, FALSE, 90),
    ('OTHER',          'Other',                   'Anything else HR asks you to upload.',         'pdf,jpg,jpeg,png',10, FALSE, FALSE, 100)
) AS d(code, display_name, description, allowed_formats, max_size_mb, required, expiry_tracked, sort_order)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 4. Permissions catalog + role grants ───────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.document.type.read',  'View document types',              'document'),
    ('hrms.document.type.write', 'Configure document types',         'document'),
    ('hrms.document.verify',     'Verify or reject employee documents','document'),
    ('hrms.document.write.self', 'Upload own documents',             'document')
ON CONFLICT (code) DO NOTHING;

-- Role grants. type.read is broad (everyone needs to see the list of required
-- docs); type.write + verify go to OWNER / SUPER_ADMIN / ADMIN / HR_MANAGER.
-- write.self goes to every employee-carrying role so a plain EMPLOYEE can
-- upload their own PAN card.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT * FROM (VALUES
    -- SUPER_ADMIN (0001)
    ('00000000-0000-0000-0000-000000000001'::UUID, 'hrms.document.type.read'),
    ('00000000-0000-0000-0000-000000000001'::UUID, 'hrms.document.type.write'),
    ('00000000-0000-0000-0000-000000000001'::UUID, 'hrms.document.verify'),
    ('00000000-0000-0000-0000-000000000001'::UUID, 'hrms.document.write.self'),
    -- HR_MANAGER (0002)
    ('00000000-0000-0000-0000-000000000002'::UUID, 'hrms.document.type.read'),
    ('00000000-0000-0000-0000-000000000002'::UUID, 'hrms.document.type.write'),
    ('00000000-0000-0000-0000-000000000002'::UUID, 'hrms.document.verify'),
    ('00000000-0000-0000-0000-000000000002'::UUID, 'hrms.document.write.self'),
    -- FINANCE_LEAD (0003)
    ('00000000-0000-0000-0000-000000000003'::UUID, 'hrms.document.type.read'),
    ('00000000-0000-0000-0000-000000000003'::UUID, 'hrms.document.write.self'),
    -- EMPLOYEE (0004)
    ('00000000-0000-0000-0000-000000000004'::UUID, 'hrms.document.type.read'),
    ('00000000-0000-0000-0000-000000000004'::UUID, 'hrms.document.write.self'),
    -- DEPT_MANAGER (0005)
    ('00000000-0000-0000-0000-000000000005'::UUID, 'hrms.document.type.read'),
    ('00000000-0000-0000-0000-000000000005'::UUID, 'hrms.document.write.self'),
    -- OWNER (0010)
    ('00000000-0000-0000-0000-000000000010'::UUID, 'hrms.document.type.read'),
    ('00000000-0000-0000-0000-000000000010'::UUID, 'hrms.document.type.write'),
    ('00000000-0000-0000-0000-000000000010'::UUID, 'hrms.document.verify'),
    ('00000000-0000-0000-0000-000000000010'::UUID, 'hrms.document.write.self'),
    -- ADMIN (0011)
    ('00000000-0000-0000-0000-000000000011'::UUID, 'hrms.document.type.read'),
    ('00000000-0000-0000-0000-000000000011'::UUID, 'hrms.document.type.write'),
    ('00000000-0000-0000-0000-000000000011'::UUID, 'hrms.document.verify'),
    ('00000000-0000-0000-0000-000000000011'::UUID, 'hrms.document.write.self'),
    -- MANAGER (0012)
    ('00000000-0000-0000-0000-000000000012'::UUID, 'hrms.document.type.read'),
    ('00000000-0000-0000-0000-000000000012'::UUID, 'hrms.document.write.self')
) AS grants(role_id, permission_code)
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── 5. GRANTs to ut_app (production DB role) ───────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ut_app') THEN
        GRANT USAGE ON SCHEMA document_mgmt TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON document_mgmt.document_types TO ut_app;
    END IF;
END $$;
