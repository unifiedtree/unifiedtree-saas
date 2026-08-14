-- ============================================================================
-- V095 - rbac.role_permissions: split visibility from write scope
-- ============================================================================
-- The original V004 policy used only USING:
--   USING (EXISTS (SELECT 1 FROM rbac.roles r
--                  WHERE r.id = role_id
--                    AND (r.tenant_id IS NULL OR r.tenant_id = current_tenant_id())))
--
-- Postgres reuses USING as WITH CHECK only for SELECT-only policies. For
-- INSERT/UPDATE/DELETE the missing WITH CHECK meant any tenant with INSERT
-- rights on rbac.role_permissions could attach (or remove) permission grants
-- on rows whose parent role is a NULL-tenant SYSTEM role (SUPER_ADMIN /
-- OWNER / HR_MANAGER / EMPLOYEE) — a cross-tenant privilege escalation.
--
-- Fix: keep reads open (tenants must be able to see their own grants AND the
-- shared system-role grants so cloneFromRoleId + permission lookups keep
-- working), but restrict writes so the affected role_id must belong to the
-- caller's own tenant. System roles (tenant_id IS NULL) are never writable
-- through this policy.
-- ============================================================================

DROP POLICY IF EXISTS role_permissions_visibility ON rbac.role_permissions;
DROP POLICY IF EXISTS role_permissions_read     ON rbac.role_permissions;
DROP POLICY IF EXISTS role_permissions_write    ON rbac.role_permissions;

-- Reads: unchanged surface — own tenant + system roles.
CREATE POLICY role_permissions_read ON rbac.role_permissions
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM rbac.roles r
                   WHERE r.id = role_id
                     AND (r.tenant_id IS NULL OR r.tenant_id = current_tenant_id())));

-- Writes (INSERT / UPDATE / DELETE): only against the caller's own tenant
-- custom roles. System roles (tenant_id IS NULL) are excluded on BOTH the
-- pre-image (USING) and the post-image (WITH CHECK) — Postgres requires WITH
-- CHECK for INSERT and UPDATE post-image, USING for UPDATE pre-image and
-- DELETE.
CREATE POLICY role_permissions_write ON rbac.role_permissions
    FOR ALL
    USING (EXISTS (SELECT 1 FROM rbac.roles r
                   WHERE r.id = role_id
                     AND r.tenant_id IS NOT NULL
                     AND r.tenant_id = current_tenant_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM rbac.roles r
                        WHERE r.id = role_id
                          AND r.tenant_id IS NOT NULL
                          AND r.tenant_id = current_tenant_id()));
