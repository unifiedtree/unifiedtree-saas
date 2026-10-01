-- Local recovery database ONLY. Uses the existing dev-seed password.
BEGIN;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
INSERT INTO auth.user_credentials
 (id, tenant_id, email, mobile_number, password_hash, employee_id,
  is_active, is_biometric_enabled, failed_login_count, created_at, updated_at, created_by, updated_by, version)
SELECT '66666666-6666-6666-6666-666666666666', tenant_id, 'owner@unifiedtree.demo', '9999988886',
       password_hash, employee_id, true, false, 0, now(), now(), 'local-recovery', 'local-recovery', 0
FROM auth.user_credentials WHERE email = 'admin@unifiedtree.demo'
ON CONFLICT (tenant_id, email) DO NOTHING;
INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666',
        '00000000-0000-0000-0000-000000000010', now(), '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;
INSERT INTO platform.tenant_modules (id, tenant_id, module_key, status, requested_at, approved_at, approved_by, activated_at)
VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'payroll', 'ACTIVE', now(), now(),
        '11111111-1111-1111-1111-111111111111', now())
ON CONFLICT (tenant_id, module_key) DO UPDATE SET status = 'ACTIVE', activated_at = now();
-- Local test entitlement; no payment provider is contacted.
INSERT INTO platform.subscriptions
 (id,tenant_id,subdomain,plan_keys,modules,seats,status,current_period_end)
VALUES ('77777777-7777-7777-7777-777777777777','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 'demo',ARRAY['hrms'],ARRAY['hrms','attendance','leave','payroll'],100,'ACTIVE',now()+interval '30 days')
ON CONFLICT(id) DO UPDATE SET seats=100,status='ACTIVE',current_period_end=excluded.current_period_end;
COMMIT;
