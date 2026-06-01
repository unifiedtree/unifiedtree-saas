-- ============================================================================
-- V903 - Dev demo: system employment types for demo company
-- ============================================================================
-- Seeds the 4 baseline employment type rows (is_system=true) for the demo
-- company created by V902. Production tenants should seed these during
-- company creation bootstrap in SaasPlatformService.
-- ============================================================================

SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO org.employment_types
    (id, tenant_id, company_id, name, code, is_payroll_eligible, is_system, is_active,
     created_at, updated_at)
VALUES
    ('eeee0001-0000-0000-0000-000000000001',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'cccccccc-cccc-cccc-cccc-cccccccccccc',
     'Full Time', 'FULL_TIME', TRUE, TRUE, TRUE,
     now(), now()),
    ('eeee0002-0000-0000-0000-000000000002',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'cccccccc-cccc-cccc-cccc-cccccccccccc',
     'Contract', 'CONTRACT', FALSE, TRUE, TRUE,
     now(), now()),
    ('eeee0003-0000-0000-0000-000000000003',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'cccccccc-cccc-cccc-cccc-cccccccccccc',
     'Intern', 'INTERN', FALSE, TRUE, TRUE,
     now(), now()),
    ('eeee0004-0000-0000-0000-000000000004',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'cccccccc-cccc-cccc-cccc-cccccccccccc',
     'Consultant', 'CONSULTANT', FALSE, TRUE, TRUE,
     now(), now())
ON CONFLICT (id) DO NOTHING;
