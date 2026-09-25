-- V143.13: exit type, HR view of another person's leave and expenses,
-- document types for every workspace, and FORCE RLS on document_mgmt.
--
-- 1. hrms.employees.exit_type. The exit flow marked everyone EXITED without
--    saying why, so the attrition report put nearly every exit under "other".
--    HR now records the type on Start notice / Mark exited (Resignation,
--    Termination, Retirement, End of contract, Absconding, Death, Other) and
--    ReportService splits resigned / terminated / other on it. Existing rows
--    keep NULL (unknown), except the legacy TERMINATED status, which can only
--    mean a termination.
-- 2. Two read permissions for the employee workspace's Leave and Expenses tabs
--    (GET /v1/leave/employees/{id}/balances, …/requests and
--    GET /v1/expense/employees/{id}/claims). Holders see ANY employee; a
--    department manager (leave l1 / expense approve) sees only their team, the
--    same team as the My team page; everyone else only themselves. Enforced in
--    EmployeeRecordAccess.
-- 3. Document types for workspaces created after V143.7: V143.7 seeded the 10
--    defaults only for tenants that existed then. Backfill every tenant that
--    has none; new workspaces are seeded lazily on their first
--    GET /v1/document/types (DocumentTypeDefaults).
-- 4. FORCE ROW LEVEL SECURITY on the document_mgmt tables, but only where the
--    app role (ut_app / hrms_app) is NOT the owner, so nothing changes for the
--    app: FORCE only binds the table owner. Runs LAST so the backfill above is
--    not filtered by it. After this, maintenance SQL run as the (non-superuser)
--    owner on these two tables must first SET app.tenant_id.
--
-- Numbered 143.13 so it cannot collide with a teammate's V144. Idempotent.

-- ── 1. Exit type ────────────────────────────────────────────────────────────
ALTER TABLE hrms.employees ADD COLUMN IF NOT EXISTS exit_type VARCHAR(30);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_employees_exit_type'
                      AND conrelid = 'hrms.employees'::regclass) THEN
        ALTER TABLE hrms.employees ADD CONSTRAINT ck_employees_exit_type
            CHECK (exit_type IS NULL OR exit_type IN
                   ('RESIGNATION', 'TERMINATION', 'RETIREMENT', 'END_OF_CONTRACT',
                    'ABSCONDING', 'DEATH', 'OTHER'));
    END IF;
END $$;

UPDATE hrms.employees
   SET exit_type = 'TERMINATION'
 WHERE exit_type IS NULL
   AND employment_status = 'TERMINATED';

-- ── 2. Read permissions for another person's leave and expenses ────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.leave.employee.read', 'View anyone''s leave', 'leave',
     'See any employee''s leave balances and leave requests on their employee record. '
     || 'Without it, department managers see only their own team and everyone else only themselves.'),
    ('hrms.expense.employee.read', 'View anyone''s expense claims', 'expense',
     'See any employee''s expense claims, line items and receipts on their employee record. '
     || 'Without it, department managers see only their own team and everyone else only themselves.')
ON CONFLICT (code) DO NOTHING;

-- OWNER and SUPER_ADMIN hold every permission (OwnerPermissionInvariantCheck
-- refuses to start the app otherwise); ADMIN and HR_MANAGER run the workforce.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.leave.employee.read'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER')
ON CONFLICT DO NOTHING;

-- Finance also pays the claims, so it sees them on the record too.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.expense.employee.read'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD')
ON CONFLICT DO NOTHING;

-- ── 3. Default document types for every tenant that has none ───────────────
-- Same 10 defaults as V143.7 (and DocumentTypeDefaults, the lazy seed).
-- Per tenant, with app.tenant_id set for that tenant: once step 4 has FORCEd RLS
-- on document_types, a re-run of this file by a (non-superuser) table owner
-- would otherwise see no rows for any tenant and then fail the policy's
-- WITH CHECK on insert. set_config(..., true) is transaction-local.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM platform.tenants LOOP
        PERFORM set_config('app.tenant_id', t.id::text, true);
        INSERT INTO document_mgmt.document_types
            (tenant_id, code, display_name, description, allowed_formats, max_size_mb, required, expiry_tracked, sort_order)
        SELECT t.id, d.code, d.display_name, d.description, d.allowed_formats, d.max_size_mb, d.required, d.expiry_tracked, d.sort_order
        FROM (VALUES
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
        WHERE NOT EXISTS (SELECT 1 FROM document_mgmt.document_types x WHERE x.tenant_id = t.id)
        ON CONFLICT (tenant_id, code) DO NOTHING;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;

-- ── 4. FORCE RLS on document_mgmt, only where the app role is not the owner ─
DO $$
DECLARE
    tbl RECORD;
BEGIN
    FOR tbl IN
        SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'document_mgmt'
           AND c.relkind IN ('r', 'p')
           AND c.relname IN ('employee_documents', 'document_types')
    LOOP
        IF tbl.owner IN ('ut_app', 'hrms_app') THEN
            RAISE NOTICE 'document_mgmt.% is owned by the app role %; FORCE RLS skipped so the app is unaffected',
                tbl.relname, tbl.owner;
        ELSE
            EXECUTE format('ALTER TABLE document_mgmt.%I FORCE ROW LEVEL SECURITY', tbl.relname);
        END IF;
    END LOOP;
END $$;
