-- ============================================================================
-- V901 - Activate HRMS, Attendance, and Leave modules for the dev demo tenant.
--
-- V900 created the demo tenant but did not seed platform.tenant_modules, so
-- workspace-status returned an empty activeModules list and the frontend showed
-- "HRMS Not Activated" for every route.
-- ============================================================================

INSERT INTO platform.tenant_modules
    (id, tenant_id, module_key, status, requested_at, approved_at, approved_by, activated_at)
VALUES
    (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
     'hrms',       'ACTIVE', now(), now(), '11111111-1111-1111-1111-111111111111'::UUID, now()),
    (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
     'attendance', 'ACTIVE', now(), now(), '11111111-1111-1111-1111-111111111111'::UUID, now()),
    (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
     'leave',      'ACTIVE', now(), now(), '11111111-1111-1111-1111-111111111111'::UUID, now())
ON CONFLICT (tenant_id, module_key) DO UPDATE
    SET status = 'ACTIVE', activated_at = now();
