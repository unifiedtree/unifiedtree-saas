-- V143.103: every company has the five default employment types (owner decision 6 Oct 2026: "4–5 fixed
-- defaults + companies can add their own; contract workers via agency").
--
-- Full-time (FULL_TIME), Part-time (PART_TIME), Contract (CONTRACT), Intern (INTERN), Consultant
-- (CONSULTANT) — the five codes an employee record could hold until now (V014's check). For EVERY existing
-- company, in every workspace, this adds only the defaults it doesn't have yet, matched by code (case and
-- spaces ignored). A row that exists — renamed, switched off, or not marked as a system row — is left exactly
-- as it is; nothing is changed or deleted. A company made after this file gets its defaults the first time
-- its types are listed (EmploymentTypeCodes.seedDefaults, the same statement for one company), whatever made
-- the company (sign-up, Master → Add company, the platform).
--
-- is_payroll_eligible = TRUE: the column default, and what payroll does (it doesn't read the flag; everyone
-- with a salary structure is paid). No column is added; no JPA entity changes. No permission.
--
-- Numbered 143.103 (reserved). Idempotent: running it again adds nothing. Production has Flyway OFF: apply by
-- hand, as the table owner (row-level security is bypassed by the migration role, V081).

INSERT INTO org.employment_types
    (id, tenant_id, company_id, name, code, is_payroll_eligible, is_system, is_active,
     created_at, updated_at, created_by, updated_by, version)
SELECT gen_random_uuid(), c.tenant_id, c.id, d.name, d.code, TRUE, TRUE, TRUE,
       now(), now(), 'V143_103', 'V143_103', 0
  FROM org.companies c
 CROSS JOIN (VALUES ('FULL_TIME',  'Full-time'),
                    ('PART_TIME',  'Part-time'),
                    ('CONTRACT',   'Contract'),
                    ('INTERN',     'Intern'),
                    ('CONSULTANT', 'Consultant')) AS d(code, name)
 WHERE NOT EXISTS (SELECT 1 FROM org.employment_types t
                    WHERE t.company_id = c.id AND upper(trim(t.code)) = d.code)
ON CONFLICT DO NOTHING;
