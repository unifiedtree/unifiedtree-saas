-- ============================================================================
-- RLS isolation proof
-- ============================================================================
-- Inserts a row for tenant A and a row for tenant B into hrms.classification_rules
-- (no FK obligations -> simplest table to prove the policy). Then asserts:
--   1. SET LOCAL app.tenant_id = <A>     ->  sees only A row
--   2. SET LOCAL app.tenant_id = <B>     ->  sees only B row
--   3. No tenant set                     ->  sees zero rows (fail-closed)
-- Each assertion runs in its own transaction so SET LOCAL is scoped correctly.
-- ============================================================================

\set TENANT_A 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set TENANT_B 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set COMPANY  'cccccccc-cccc-cccc-cccc-cccccccccccc'

-- ---------------------------------------------------------------------------
-- 0. Clean up anything left from a previous run (as a superuser bypass would,
--    but we don't have that — we'll insert via SET LOCAL too).
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL app.tenant_id = :'TENANT_A';
DELETE FROM hrms.classification_rules WHERE name IN ('TenantA_TestRule','TenantB_TestRule');
COMMIT;

BEGIN;
SET LOCAL app.tenant_id = :'TENANT_B';
DELETE FROM hrms.classification_rules WHERE name IN ('TenantA_TestRule','TenantB_TestRule');
COMMIT;

-- ---------------------------------------------------------------------------
-- 1. Insert one row as tenant A
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL app.tenant_id = :'TENANT_A';
INSERT INTO hrms.classification_rules (id, tenant_id, company_id, name, code, is_active, created_at, updated_at, version)
VALUES (gen_random_uuid(), :'TENANT_A', :'COMPANY', 'TenantA_TestRule', 'A1', TRUE, now(), now(), 0);
COMMIT;

-- ---------------------------------------------------------------------------
-- 2. Insert one row as tenant B
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL app.tenant_id = :'TENANT_B';
INSERT INTO hrms.classification_rules (id, tenant_id, company_id, name, code, is_active, created_at, updated_at, version)
VALUES (gen_random_uuid(), :'TENANT_B', :'COMPANY', 'TenantB_TestRule', 'B1', TRUE, now(), now(), 0);
COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Query as tenant A -> must see only A row
-- ---------------------------------------------------------------------------
\echo '=== As tenant A (expect 1 row, name TenantA_TestRule) ==='
BEGIN;
SET LOCAL app.tenant_id = :'TENANT_A';
SELECT name, code, tenant_id::text AS tenant FROM hrms.classification_rules
 WHERE name LIKE 'Tenant%_TestRule' ORDER BY name;
COMMIT;

-- ---------------------------------------------------------------------------
-- 4. Query as tenant B -> must see only B row
-- ---------------------------------------------------------------------------
\echo '=== As tenant B (expect 1 row, name TenantB_TestRule) ==='
BEGIN;
SET LOCAL app.tenant_id = :'TENANT_B';
SELECT name, code, tenant_id::text AS tenant FROM hrms.classification_rules
 WHERE name LIKE 'Tenant%_TestRule' ORDER BY name;
COMMIT;

-- ---------------------------------------------------------------------------
-- 5. Query with no tenant set -> must see zero rows (fail-closed)
-- ---------------------------------------------------------------------------
\echo '=== With no app.tenant_id (expect 0 rows) ==='
BEGIN;
SELECT name, code, tenant_id::text AS tenant FROM hrms.classification_rules
 WHERE name LIKE 'Tenant%_TestRule';
COMMIT;
