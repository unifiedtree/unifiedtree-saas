-- ============================================================================
-- V112 - Default-deny the over-granted role seeds (QA 2026-08-30, P0-1/2/3)
-- ============================================================================
-- Client rule, stated 2026-08-30:
--   "dept manager cannot see, hr manager can see, but admin can modify the
--    access of each options what they can see or shouldnt see"
--   "we should not just hide, we need drop them - when admin gives access
--    only then he can see, otherwise not"
--
-- i.e. DEFAULT-DENY. A role ships with the minimum it needs; the workspace
-- admin grants anything extra per role through Settings -> Roles & Permissions,
-- which already writes to this same table via
--   PUT /v1/rbac/roles/{roleId}/permissions   (RbacController:65)
-- so every revoke below is reversible from inside the product. Nothing here is
-- a one-way door.
--
-- ── P0-1  DEPT_MANAGER loses hrms.employee.read ─────────────────────────────
-- Live proof before this migration: a DEPT_MANAGER token on
--   GET /v1/hrms/employees?page=0&size=50
-- returned 200 with totalElements=5 -- the ENTIRE company -- in a payload
-- byte-identical to the OWNER's, including bankIfsc, uan, esi and dateOfBirth.
-- The only thing standing between a department manager and every colleague's
-- bank details was a hidden nav link and a code comment.
--
-- Verified this does NOT break their legitimate team view. Everything a
-- DEPT_MANAGER actually needs resolves through a DIFFERENT permission:
--   /team                     anyOf[attendance.team.read, hrms.leave.approve.l1]  (App.tsx:243)
--   /hrms/attendance, :387    anyOf[attendance.team.read, hrms.employee.read]     -> team.read
--   /hrms/att-analytics, :485 anyOf[attendance.team.read, hrms.employee.read]     -> team.read
--   /hrms/ess, :287 :554      anyOf[hrms.ess.read, ..., attendance.checkin.self]  -> ess.read
-- What they DO lose, deliberately: /hrms/employees (the roster) and
-- /hrms/employees/{id} (EmployeeDetail), both gated solely on this code.
--
-- ── P0-2  HR_MANAGER loses rbac.role.write ──────────────────────────────────
-- HR is deliberately denied every rupee screen (payroll.* is not in its seed).
-- But rbac.role.write is the permission that edits permissions -- so HR could
-- simply grant itself payroll.runs.read and walk in. Locking the doors while
-- handing over the key cabinet. With the client's rule that only the admin
-- decides access, this belongs to OWNER/SUPER_ADMIN alone.
--
-- ── P0-3  HR_MANAGER loses workspace.users.* and audit.read ─────────────────
-- The nav hides Users & Access and Audit Logs from HR (PlatformShell.tsx:252,254)
-- but the routes passed and the API answered: GET /v1/workspace/users returned
-- 200 with every account, its roles, status and lastLoginAt -- including the
-- owner's. Hiding a link is not access control. Per the client: drop it, and
-- let the admin grant it back if a given company wants HR administering users.
--
-- NOT TOUCHED HERE:
--   * OWNER / SUPER_ADMIN keep everything.
--   * FINANCE_LEAD is left exactly as-is -- its over-grants (letters.*,
--     leave.approve.l2, employee.import) are noted as P2 and need a separate
--     product decision, not a silent revoke in a security migration.
--   * No payroll grant is added for HR. The nav promising Payroll to HR
--     (R_FIN_META) is fixed on the frontend instead -- granting perms to make
--     a wrong menu correct would be backwards.
--
-- Idempotent: plain DELETEs matched on role code + permission code. Re-running
-- is a no-op. Flyway is disabled in prod (see V075), so this file is the paper
-- trail and the statements are applied manually via psycopg.
-- ============================================================================

-- P0-1  Both manager role codes. useRoles.ts buckets MANAGER_ROLES as
-- ['DEPT_MANAGER','MANAGER'], so leaving MANAGER holding the permission would
-- reopen the same hole for anyone assigned that role instead.
DELETE FROM rbac.role_permissions rp
 USING rbac.roles r
 WHERE r.id = rp.role_id
   AND r.code IN ('DEPT_MANAGER', 'MANAGER')
   AND rp.permission_code = 'hrms.employee.read';

-- P0-2
DELETE FROM rbac.role_permissions rp
 USING rbac.roles r
 WHERE r.id = rp.role_id
   AND r.code = 'HR_MANAGER'
   AND rp.permission_code = 'rbac.role.write';

-- P0-3
DELETE FROM rbac.role_permissions rp
 USING rbac.roles r
 WHERE r.id = rp.role_id
   AND r.code = 'HR_MANAGER'
   AND rp.permission_code IN ('workspace.users.read', 'workspace.users.manage', 'audit.read');

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE leftovers INT;
BEGIN
    SELECT count(*) INTO leftovers
      FROM rbac.role_permissions rp
      JOIN rbac.roles r ON r.id = rp.role_id
     WHERE (r.code = 'DEPT_MANAGER' AND rp.permission_code = 'hrms.employee.read')
        OR (r.code = 'HR_MANAGER'   AND rp.permission_code IN
              ('rbac.role.write','workspace.users.read','workspace.users.manage','audit.read'));
    RAISE NOTICE 'V112: over-grants remaining = % (expect 0)', leftovers;
END $$;
