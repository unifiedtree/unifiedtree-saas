-- ============================================================================
-- V105__employee_baseline_for_all_human_roles.sql
--
-- Grant the EMPLOYEE self-service baseline to every role a real person can hold.
--
-- INCIDENT (2026-08-18, nclever tenant)
-- ------------------------------------
-- A staff member promoted to DEPT_MANAGER lost the ability to enrol their own
-- face and to punch in by face. The mobile app showed only "Could not start
-- face enrollment"; the backend was returning 403 on
-- GET /v1/attendance/face/enrollment-status, which requires
-- attendance.face.enroll.self OR attendance.face.verify.self.
--
-- Root cause: "employee" was modelled as a ROLE. Promotion replaced the
-- EMPLOYEE role with DEPT_MANAGER, and DEPT_MANAGER had never been granted the
-- self-service permissions — so the promotion silently revoked them.
--
-- The audit found the gap was systemic, not limited to face:
--     DEPT_MANAGER   missing 10 of 27 baseline permissions
--     FINANCE_LEAD   missing 12
--     HR_MANAGER     missing  7   (could not read their own payslip)
--     SUPER_ADMIN    missing  6   (could not read their own payslip)
--     ADMIN/MANAGER  missing 25   (legacy roles, currently unassigned)
--     SECURITY       missing 24
--     OWNER          missing  0   (the only correct role)
--
-- FIX (two layers, deliberately)
-- ------------------------------
--  1. Code: AuthService + PermissionChecker now union the EMPLOYEE baseline
--     into the effective permissions of any principal whose credential carries
--     an employee_id. That makes the invariant impossible to break in future,
--     including for roles that do not exist yet.
--  2. This migration: bring the stored grants in line with that invariant, so
--     the database is self-consistent and any consumer that reads
--     rbac.role_permissions directly (SPA gating, reports, support queries)
--     reaches the same verdict as the JWT.
--
-- SCOPE
-- -----
-- PLATFORM_SUPER_ADMIN is deliberately EXCLUDED. It is a platform-operator
-- role, not a person employed by a tenant: no payslip, no face to enrol,
-- nothing to clock in to. Granting it employee self-service permissions would
-- widen the blast radius of the most privileged role in the system for no
-- functional gain.
--
-- Idempotent: Flyway is disabled in prod (see flyway-must-stay-disabled) and
-- this file is applied by hand, possibly more than once. The NOT EXISTS guard
-- makes re-runs a no-op.
-- ============================================================================

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, base.permission_code
  FROM rbac.roles r
  CROSS JOIN (
      SELECT rp.permission_code
        FROM rbac.role_permissions rp
        JOIN rbac.roles er ON er.id = rp.role_id
       WHERE er.code = 'EMPLOYEE'
  ) AS base
 WHERE r.code IN (
        'OWNER',
        'SUPER_ADMIN',
        'ADMIN',
        'HR_MANAGER',
        'DEPT_MANAGER',
        'MANAGER',
        'FINANCE_LEAD',
        'SECURITY'
       )
   AND NOT EXISTS (
        SELECT 1
          FROM rbac.role_permissions existing
         WHERE existing.role_id = r.id
           AND existing.permission_code = base.permission_code
       );

-- Verification (run manually after applying; every row should report 0):
--
--   SELECT r.code,
--          COUNT(*) FILTER (
--            WHERE b.permission_code NOT IN (
--              SELECT permission_code FROM rbac.role_permissions WHERE role_id = r.id
--            )
--          ) AS missing_from_baseline
--     FROM rbac.roles r
--     CROSS JOIN (
--       SELECT rp.permission_code FROM rbac.role_permissions rp
--         JOIN rbac.roles er ON er.id = rp.role_id WHERE er.code = 'EMPLOYEE'
--     ) b
--    WHERE r.code IN ('OWNER','SUPER_ADMIN','ADMIN','HR_MANAGER',
--                     'DEPT_MANAGER','MANAGER','FINANCE_LEAD','SECURITY')
--    GROUP BY r.code
--    ORDER BY r.code;
--
-- NOTE: users holding an already-issued JWT keep their old permission claim
-- until it is re-minted. They must sign out and back in (or wait for refresh)
-- to pick up the restored permissions.
