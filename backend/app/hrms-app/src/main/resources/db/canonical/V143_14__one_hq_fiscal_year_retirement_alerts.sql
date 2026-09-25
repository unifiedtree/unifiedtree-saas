-- V143.14: one headquarters per company, one fiscal year per company, and
-- retirement alerts (w1e, 25 Sep 2026).
--
-- 1. One headquarters per company, enforced by the database.
--    Until now the web app switched the old headquarters off with a second
--    call after saving the new one, so a failed second call left a company
--    with two headquarters. BranchService now swaps them in one transaction;
--    this partial unique index makes a second active headquarters impossible.
--    Existing duplicates are resolved first: the most recently updated branch
--    stays the headquarters (that is the one an admin chose last), the others
--    become ordinary branches. Archived branches are ignored by the rule.
--
-- 2. The company record holds the fiscal year (decision D2).
--    HR Configuration had its own copy (settings.hr_configuration.fiscal_year_start)
--    that nothing read, while the company record (org.companies.fiscal_year_start)
--    is what the Companies API returns. HR Configuration now reads and writes the
--    company record. Where an admin had already picked a month other than April
--    on HR Configuration and the company still had the default, that choice is
--    carried over. Blank or unreadable values become APRIL (the Indian
--    financial year, April to March).
--
-- 3. Retirement alerts. New permission hrms.retirement.alerts: people holding
--    it get an in-app and push alert 90 days and again 30 days before someone
--    reaches the company's retirement age (HR Configuration). Granted to
--    OWNER and SUPER_ADMIN (they must hold every permission, or the app will
--    not start: OwnerPermissionInvariantCheck), ADMIN and HR_MANAGER.
--    The alerts are logged in the existing notif.milestone_reminder_log, so
--    no new table is needed.
--
-- org.branches, org.companies and settings.hr_configuration FORCE row-level
-- security, so the data fixes run once per tenant with the tenant set, which
-- works whether or not the migrating role bypasses RLS.
--
-- Idempotent: safe to run again.

-- ── 1 + 2. per-tenant data fixes ───────────────────────────────────────────
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM platform.tenants LOOP
        PERFORM set_config('app.tenant_id', t.id::text, true);

        -- One active headquarters per company: keep the latest choice.
        UPDATE org.branches b
           SET is_headquarters = FALSE,
               updated_at = now()
          FROM (
                SELECT id,
                       row_number() OVER (PARTITION BY company_id
                                          ORDER BY updated_at DESC, created_at DESC, id) AS rn
                  FROM org.branches
                 WHERE tenant_id = t.id
                   AND is_headquarters
                   AND is_active
               ) ranked
         WHERE b.id = ranked.id
           AND ranked.rn > 1;

        -- Carry over a fiscal year an admin chose on HR Configuration.
        UPDATE org.companies c
           SET fiscal_year_start = upper(trim(h.fiscal_year_start)),
               updated_at = now()
          FROM settings.hr_configuration h
         WHERE h.company_id = c.id
           AND h.tenant_id = t.id
           AND c.tenant_id = t.id
           AND upper(trim(coalesce(h.fiscal_year_start, ''))) IN
               ('JANUARY','FEBRUARY','MARCH','MAY','JUNE','JULY','AUGUST',
                'SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER')
           AND (c.fiscal_year_start IS NULL OR upper(trim(c.fiscal_year_start)) IN ('', 'APRIL'));

        -- Normalise: upper case, and April when blank or not a month name.
        UPDATE org.companies c
           SET fiscal_year_start = CASE
                   WHEN upper(trim(coalesce(c.fiscal_year_start, ''))) IN
                        ('JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST',
                         'SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER')
                   THEN upper(trim(c.fiscal_year_start))
                   ELSE 'APRIL' END,
               updated_at = now()
         WHERE c.tenant_id = t.id
           AND (c.fiscal_year_start IS NULL
                OR c.fiscal_year_start <> upper(trim(c.fiscal_year_start))
                OR upper(trim(c.fiscal_year_start)) NOT IN
                   ('JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST',
                    'SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'));
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_branches_one_active_hq_per_company
    ON org.branches (tenant_id, company_id)
 WHERE is_headquarters AND is_active;

COMMENT ON INDEX org.ux_branches_one_active_hq_per_company IS
    'A company has at most one active headquarters. BranchService switches the previous one off in the same transaction.';

COMMENT ON COLUMN settings.hr_configuration.fiscal_year_start IS
    'Not used since V143.14: the fiscal year lives on org.companies.fiscal_year_start, which HR Configuration reads and writes.';

-- ── 3. retirement alerts permission ────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description)
     VALUES ('hrms.retirement.alerts', 'Get retirement alerts',
             'hrms', 'Receive an in-app and push alert 90 days, and again 30 days, before someone reaches the company''s retirement age (set in HR Configuration). Alerts name the person and their retirement date.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.retirement.alerts'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER')
ON CONFLICT DO NOTHING;
