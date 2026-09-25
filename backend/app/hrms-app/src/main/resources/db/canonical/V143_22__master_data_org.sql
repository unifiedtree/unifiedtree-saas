-- V143.22: Master data, organisation setup (docs/Designs/STATIC-UI-TO-BUILD.md §6).
--
-- Everything here was visible on the Master pages as "Coming soon" because
-- the database had nowhere to keep it:
--
--   1. Grade pay bands: the annual CTC range (minimum / maximum) of each grade.
--      Salary Structure warns (never blocks) when someone's CTC falls outside
--      the band of their designation's grade. Bands are pay data, so reading
--      them needs the new permission hrms.grade.band.read (the grade list
--      itself stays open to every signed-in user; the band is left out).
--   2. Designations link to a grade by id (grade_id), not just by free text,
--      and carry their own code. Existing free-text grades are linked where a
--      grade of the same company has that code (or that name); anything that
--      matches no grade keeps its text and shows as a plain chip.
--   3. Contractor agencies: licence number and expiry, the service they
--      provide, the branches they deploy to (hrms.contractor_sites) and the
--      contract workers they supply (hrms.contractor_workers: employees whose
--      employment type is CONTRACT, one agency each). The worker count is
--      computed from those links, never typed in.
--   4. Companies: TAN, date of incorporation ("since") and a description.
--   5. Branches: a branch type (Head office, Branch, Plant, Warehouse, Office,
--      Store, Other). is_headquarters stays the source of truth for the head
--      office, so this column only matters for the other branches.
--
-- Department parent moves, department branches (hrms.department_branches,
-- which already exists) and the classification update need no schema change.
--
-- Numbered 143.22 so it cannot collide with a teammate's migration.
-- Idempotent: every statement can be run again safely.

-- ── 1. Grade pay bands ────────────────────────────────────────────────────
ALTER TABLE org.grades ADD COLUMN IF NOT EXISTS min_ctc_annual NUMERIC(14,2);
ALTER TABLE org.grades ADD COLUMN IF NOT EXISTS max_ctc_annual NUMERIC(14,2);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_grades_ctc_band') THEN
        ALTER TABLE org.grades ADD CONSTRAINT ck_grades_ctc_band CHECK (
            (min_ctc_annual IS NULL AND max_ctc_annual IS NULL)
            OR (min_ctc_annual IS NOT NULL AND max_ctc_annual IS NOT NULL
                AND min_ctc_annual >= 0 AND max_ctc_annual > min_ctc_annual));
    END IF;
END $$;

INSERT INTO rbac.permissions (code, display_name, module, description)
     VALUES ('hrms.grade.band.read', 'View grade pay bands', 'hrms',
             'See the minimum and maximum annual CTC set for each grade, and the '
             || 'band warning on Salary Structure. Pay bands are salary information: '
             || 'people without this permission still see the grades, but not the amounts.')
ON CONFLICT (code) DO NOTHING;

-- OWNER and SUPER_ADMIN hold every permission (OwnerPermissionInvariantCheck);
-- the other roles are the ones that already see or set pay.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.grade.band.read'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD')
ON CONFLICT DO NOTHING;

-- ── 2. Designation -> grade by id, designation codes ──────────────────────
ALTER TABLE hrms.designations ADD COLUMN IF NOT EXISTS grade_id UUID;
ALTER TABLE hrms.designations ADD COLUMN IF NOT EXISTS code VARCHAR(30);
-- The free-text grade mirrors the linked grade's code (up to 20 characters).
ALTER TABLE hrms.designations ALTER COLUMN grade TYPE VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_designations_grade') THEN
        ALTER TABLE hrms.designations ADD CONSTRAINT fk_designations_grade
            FOREIGN KEY (grade_id) REFERENCES org.grades(id) ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_designations_grade ON hrms.designations (tenant_id, grade_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_designation_tenant_code
    ON hrms.designations (tenant_id, company_id, upper(code)) WHERE code IS NOT NULL;

-- Link today's free-text grades: a grade of the same company whose code
-- matches wins over one whose name matches. Unmatched rows are left alone.
UPDATE hrms.designations d
   SET grade_id = m.grade_id,
       grade    = m.grade_code
  FROM (
        SELECT DISTINCT ON (d2.id) d2.id AS designation_id, g.id AS grade_id, g.code AS grade_code
          FROM hrms.designations d2
          JOIN org.grades g
            ON g.tenant_id = d2.tenant_id
           AND g.company_id = d2.company_id
           AND g.is_active
           AND (upper(trim(g.code)) = upper(trim(d2.grade)) OR upper(trim(g.name)) = upper(trim(d2.grade)))
         WHERE d2.grade_id IS NULL
           AND d2.grade IS NOT NULL
           AND trim(d2.grade) <> ''
         ORDER BY d2.id, (upper(trim(g.code)) = upper(trim(d2.grade))) DESC, g.level
       ) m
 WHERE d.id = m.designation_id;

-- ── 3. Contractor agencies ────────────────────────────────────────────────
ALTER TABLE hrms.contractors ADD COLUMN IF NOT EXISTS licence_number      VARCHAR(60);
ALTER TABLE hrms.contractors ADD COLUMN IF NOT EXISTS licence_valid_until DATE;
ALTER TABLE hrms.contractors ADD COLUMN IF NOT EXISTS service_type        VARCHAR(150);

-- Branches an agency deploys people to.
CREATE TABLE IF NOT EXISTS hrms.contractor_sites (
    tenant_id     UUID        NOT NULL,
    contractor_id UUID        NOT NULL REFERENCES hrms.contractors(id) ON DELETE CASCADE,
    branch_id     UUID        NOT NULL REFERENCES org.branches(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contractor_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_contractor_sites_tenant ON hrms.contractor_sites (tenant_id);

-- Contract workers an agency supplies: one agency per employee.
CREATE TABLE IF NOT EXISTS hrms.contractor_workers (
    tenant_id     UUID         NOT NULL,
    employee_id   UUID         PRIMARY KEY REFERENCES hrms.employees(id) ON DELETE CASCADE,
    contractor_id UUID         NOT NULL REFERENCES hrms.contractors(id) ON DELETE CASCADE,
    linked_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    linked_by     VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_contractor_workers_agency ON hrms.contractor_workers (tenant_id, contractor_id);

ALTER TABLE hrms.contractor_sites   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.contractor_sites   FORCE ROW LEVEL SECURITY;
ALTER TABLE hrms.contractor_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.contractor_workers FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hrms' AND tablename = 'contractor_sites'
                      AND policyname = 'tenant_isolation_contractor_sites') THEN
        CREATE POLICY tenant_isolation_contractor_sites ON hrms.contractor_sites
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hrms' AND tablename = 'contractor_workers'
                      AND policyname = 'tenant_isolation_contractor_workers') THEN
        CREATE POLICY tenant_isolation_contractor_workers ON hrms.contractor_workers
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 4. Companies: TAN, incorporation date, description ────────────────────
ALTER TABLE org.companies ADD COLUMN IF NOT EXISTS tan_number         VARCHAR(10);
ALTER TABLE org.companies ADD COLUMN IF NOT EXISTS incorporation_date DATE;
ALTER TABLE org.companies ADD COLUMN IF NOT EXISTS description        TEXT;

-- ── 5. Branch types ───────────────────────────────────────────────────────
ALTER TABLE org.branches ADD COLUMN IF NOT EXISTS branch_type VARCHAR(20) NOT NULL DEFAULT 'BRANCH';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_branches_branch_type') THEN
        ALTER TABLE org.branches ADD CONSTRAINT ck_branches_branch_type CHECK (
            branch_type IN ('HEAD_OFFICE','BRANCH','PLANT','WAREHOUSE','OFFICE','STORE','OTHER'));
    END IF;
END $$;
UPDATE org.branches SET branch_type = 'HEAD_OFFICE' WHERE is_headquarters AND branch_type = 'BRANCH';

-- ── 6. Grants to the application role ─────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.contractor_sites   TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.contractor_workers TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.department_branches TO ut_app;
    END IF;
END $$;
