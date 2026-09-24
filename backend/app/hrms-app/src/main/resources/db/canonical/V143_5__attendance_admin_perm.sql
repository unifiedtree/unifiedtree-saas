-- V143.5 — split shift definitions and manual attendance entry away from the
-- regularization approve permission. Found by the 2026-09-24 manager review:
--   * DEPT_MANAGER holds attendance.regularization.approve so they can approve
--     regularization requests, but the same permission also lets them CREATE,
--     UPDATE and DELETE the company's shift definitions and mark manual
--     attendance for anyone in the tenant (including themselves).
-- The new permission attendance.workforce.admin covers both admin actions and
-- is seeded only to HR / owner / super_admin / admin.
--
-- Numbered 143.5 so it cannot collide with a teammate's V144. Idempotent.

INSERT INTO rbac.permissions (code, display_name, module, description)
     VALUES ('attendance.workforce.admin', 'Attendance workforce admin',
             'attendance', 'Manage shift definitions and record manual attendance for other employees')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.workforce.admin'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'HR_MANAGER', 'ADMIN', 'COMPANY_ADMIN')
ON CONFLICT DO NOTHING;
