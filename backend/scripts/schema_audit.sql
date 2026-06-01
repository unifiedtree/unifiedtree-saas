-- ============================================================================
-- Canonical schema audit script
-- ============================================================================
-- Reports any deviation from the production-safety invariants:
--
--   1. Every table in a tenant-owned schema (org, hrms, attendance,
--      leave_mgmt, settings) HAS a tenant_id column.
--   2. Every such table has Row-Level Security ENABLED.
--   3. Every such table has FORCE ROW LEVEL SECURITY set (so the migration
--      role's owner-bypass doesn't make RLS a no-op).
--   4. Every such table has at least one index that starts with tenant_id.
--   5. Every tenant-owned table has at least one RLS policy attached.
--   6. Partitioned tables (attendance.records, attendance.event_logs,
--      audit.events) have all their child partitions inheriting RLS.
--
-- Usage:
--   psql -U <role> -d <db> -f scripts/schema_audit.sql
-- ============================================================================

\timing off
\pset border 2
\pset format aligned

-- We treat these schemas as tenant-owned. rbac is mostly catalog with a
-- special policy for tenant-custom rows; auth is tenant-owned; audit and
-- platform are intentionally NOT tenant-scoped per ARCHITECTURE.md and
-- excluded from this audit.
\set tenant_schemas '''auth'',''org'',''hrms'',''attendance'',''leave_mgmt'',''settings'''

-- ---------------------------------------------------------------------------
-- 1. Tables missing a tenant_id column
-- ---------------------------------------------------------------------------
\echo
\echo '=== 1. Tables in tenant-owned schemas WITHOUT a tenant_id column ==='
SELECT n.nspname || '.' || c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname IN (:tenant_schemas)
  AND c.relkind = 'r'
  AND c.relname NOT LIKE 'flyway_%'
  -- partition children look like records_2026_05; the parent records is
  -- the only one we want to audit. SKIP children whose parent already
  -- has the column; partition children inherit columns by definition.
  AND NOT EXISTS (
      SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid
  )
  AND NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
  )
ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- 2. Tables with tenant_id but RLS DISABLED
-- ---------------------------------------------------------------------------
\echo
\echo '=== 2. Tables with tenant_id but RLS NOT enabled ==='
SELECT n.nspname || '.' || c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname IN (:tenant_schemas)
  AND c.relkind = 'r'
  AND c.relname NOT LIKE 'flyway_%'
  AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
  AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
  )
  AND c.relrowsecurity = FALSE
ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- 3. Tables with RLS enabled but FORCE NOT set
-- ---------------------------------------------------------------------------
\echo
\echo '=== 3. RLS-enabled tables WITHOUT FORCE ROW LEVEL SECURITY ==='
SELECT n.nspname || '.' || c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname IN (:tenant_schemas)
  AND c.relkind = 'r'
  AND c.relname NOT LIKE 'flyway_%'
  AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
  AND c.relrowsecurity = TRUE
  AND c.relforcerowsecurity = FALSE
ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- 4. tenant_id columns without an index starting with tenant_id
-- ---------------------------------------------------------------------------
\echo
\echo '=== 4. Tables with tenant_id column but no index starting with tenant_id ==='
WITH tenant_tables AS (
    SELECT c.oid AS rel, n.nspname || '.' || c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = c.oid
                       AND a.attname  = 'tenant_id'
                       AND NOT a.attisdropped
    WHERE n.nspname IN (:tenant_schemas)
      AND c.relkind = 'r'
      AND c.relname NOT LIKE 'flyway_%'
      AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
),
indexes AS (
    SELECT i.indrelid AS rel,
           i.indkey[0] AS first_col,
           (SELECT attname FROM pg_attribute
              WHERE attrelid = i.indrelid AND attnum = i.indkey[0]) AS first_col_name
    FROM pg_index i
)
SELECT tt.table_name
FROM tenant_tables tt
WHERE NOT EXISTS (
    SELECT 1 FROM indexes idx
    WHERE idx.rel = tt.rel AND idx.first_col_name = 'tenant_id'
)
ORDER BY tt.table_name;

-- ---------------------------------------------------------------------------
-- 5. RLS-enabled tables without any policy
-- ---------------------------------------------------------------------------
\echo
\echo '=== 5. RLS-enabled tables without any attached policy ==='
SELECT n.nspname || '.' || c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname IN (:tenant_schemas)
  AND c.relkind = 'r'
  AND c.relname NOT LIKE 'flyway_%'
  AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
  AND c.relrowsecurity = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = n.nspname AND p.tablename = c.relname
  )
ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- 6. Partitioned tables and their partition health
-- ---------------------------------------------------------------------------
\echo
\echo '=== 6. Partitioned tables and partition counts ==='
SELECT parent.relname            AS parent_table,
       partns.partn_count        AS partition_count,
       parent.relrowsecurity     AS parent_rls,
       parent.relforcerowsecurity AS parent_force_rls
FROM pg_class parent
JOIN pg_namespace n ON parent.relnamespace = n.oid
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS partn_count
    FROM pg_inherits i WHERE i.inhparent = parent.oid
) partns ON TRUE
WHERE parent.relkind = 'p'
  AND n.nspname IN ('attendance','audit')
ORDER BY n.nspname, parent.relname;

\echo
\echo '=== 7. Partition children with RLS DISABLED ==='
-- RLS is inherited automatically; this should always be empty. If it
-- prints rows, a CREATE PARTITION OF skipped the parent's RLS setting.
SELECT pn.nspname || '.' || pc.relname AS partition,
       parent_ns.nspname || '.' || parent.relname AS parent
FROM pg_inherits i
JOIN pg_class pc ON i.inhrelid = pc.oid
JOIN pg_namespace pn ON pc.relnamespace = pn.oid
JOIN pg_class parent ON i.inhparent = parent.oid
JOIN pg_namespace parent_ns ON parent.relnamespace = parent_ns.oid
WHERE pn.nspname IN ('attendance','audit')
  AND parent.relrowsecurity = TRUE
  AND pc.relrowsecurity = FALSE
ORDER BY partition;

\echo
\echo '=== Audit complete. If sections 1-5 and 7 are empty and section 6 shows >0 partitions, the canonical schema is production-shaped. ==='
