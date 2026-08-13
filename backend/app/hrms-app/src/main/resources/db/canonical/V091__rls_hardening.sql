-- ============================================================================
-- V091 - RLS hardening (Bundle E, 2026-08-13)
-- ----------------------------------------------------------------------------
-- Full-sweep RLS audit (D11) uncovered four defense-in-depth holes:
--
--   CRIT  public.geo_fence_zones   — RLS DISABLED, tenant_id NOT NULL. A
--         controller bug that calls findById(zoneId) with no tenant filter
--         allows cross-tenant IDOR on PUT/DELETE /v1/attendance/geofence/
--         zones/{zoneId}. (Java belt-and-braces is applied in the same
--         commit; RLS is the last-line safety net.)
--   CRIT  public.geo_fence_audits  — RLS DISABLED, tenant_id NOT NULL. No
--         read/write endpoint today, but any future admin report that
--         forgets WHERE tenant_id=? silently leaks every tenant's rows.
--   HIGH  rbac.roles               — tenant_isolation_roles is cmd=ALL with
--         qual '((tenant_id IS NULL) OR (tenant_id = current_tenant_id()))'
--         and with_check=NULL, so PostgreSQL reuses qual as the WITH CHECK
--         expression. Any tenant can INSERT a row with tenant_id=NULL and
--         it becomes a "system role" visible to every other tenant. Fix:
--         split into a permissive SELECT policy (keeps existing NULL-tenant
--         seed rows visible) and a scoped ALL policy that enforces
--         WITH CHECK (tenant_id = current_tenant_id()). Superuser
--         migrations (postgres has BYPASSRLS + is table owner alt-BYPASS)
--         remain able to seed NULL-tenant system roles.
--   HIGH  audit.events             — audit_insert_permissive is cmd=INSERT
--         with_check='true'. Any tenant with an app.tenant_id GUC set can
--         insert an audit row for any other tenant, poisoning the
--         compliance stream. Fix: replace with an INSERT policy that
--         enforces WITH CHECK (tenant_id = current_tenant_id()).
--
-- Introspection (2026-08-13) confirmed the actual policy names on prod:
--   rbac.roles   → tenant_isolation_roles   (single ALL policy)
--   audit.events → audit_insert_permissive  (INSERT) +
--                  tenant_isolation_audit_read (SELECT, correct — untouched)
-- The two geofence tables have no existing policies.
--
-- Rollback: all objects are re-creatable; RLS can be disabled via
-- ALTER TABLE ... DISABLE ROW LEVEL SECURITY if the change misfires.
-- ============================================================================

-- ── CRIT: public.geo_fence_zones ───────────────────────────────────────────
ALTER TABLE public.geo_fence_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_fence_zones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_geo_fence_zones ON public.geo_fence_zones;
CREATE POLICY tenant_isolation_geo_fence_zones ON public.geo_fence_zones
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── CRIT: public.geo_fence_audits ──────────────────────────────────────────
ALTER TABLE public.geo_fence_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_fence_audits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_geo_fence_audits ON public.geo_fence_audits;
CREATE POLICY tenant_isolation_geo_fence_audits ON public.geo_fence_audits
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── HIGH: rbac.roles — split permissive-SELECT / scoped-write ──────────────
-- Preserve visibility of the 9 seeded NULL-tenant system roles (SUPER_ADMIN,
-- OWNER, HR_MANAGER, …) but forbid the app from ever *writing* a NULL-tenant
-- row. Only the postgres superuser (BYPASSRLS + table owner) can seed system
-- roles going forward — which is what future migrations already do.
DROP POLICY IF EXISTS tenant_isolation_roles ON rbac.roles;
DROP POLICY IF EXISTS rbac_roles_select    ON rbac.roles;
DROP POLICY IF EXISTS rbac_roles_write     ON rbac.roles;
CREATE POLICY rbac_roles_select ON rbac.roles
    FOR SELECT
    USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY rbac_roles_write ON rbac.roles
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── HIGH: audit.events INSERT policy — enforce tenant scoping ──────────────
-- SELECT policy tenant_isolation_audit_read is already correct; leave it.
DROP POLICY IF EXISTS audit_insert_permissive        ON audit.events;
DROP POLICY IF EXISTS audit_insert_tenant_scoped     ON audit.events;
CREATE POLICY audit_insert_tenant_scoped ON audit.events
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

-- ── Verification log ───────────────────────────────────────────────────────
DO $$
DECLARE
    v_geo_zones_rls  BOOLEAN;
    v_geo_audits_rls BOOLEAN;
    v_roles_write    INT;
    v_audit_insert   INT;
BEGIN
    SELECT relrowsecurity INTO v_geo_zones_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='geo_fence_zones';

    SELECT relrowsecurity INTO v_geo_audits_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='geo_fence_audits';

    SELECT count(*) INTO v_roles_write
      FROM pg_policies
     WHERE schemaname='rbac' AND tablename='roles'
       AND policyname='rbac_roles_write';

    SELECT count(*) INTO v_audit_insert
      FROM pg_policies
     WHERE schemaname='audit' AND tablename='events'
       AND policyname='audit_insert_tenant_scoped';

    RAISE NOTICE 'V091 verify: geo_fence_zones.rls=%, geo_fence_audits.rls=%, rbac.roles write policy count=%, audit.events insert policy count=%',
        v_geo_zones_rls, v_geo_audits_rls, v_roles_write, v_audit_insert;
END $$;
