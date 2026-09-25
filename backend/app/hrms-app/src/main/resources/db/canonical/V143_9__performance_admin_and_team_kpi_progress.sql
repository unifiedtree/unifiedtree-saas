-- V143.9: performance access decided with the client on 2026-09-25.
--
-- 1. ADMIN runs performance like HR. It already held hrms.appraisal.initiate
--    and hrms.kpi.manage, but without hrms.performance.read it could not list
--    the cycles, reviews or KPIs it was allowed to manage, and without
--    hrms.performance.write it could not create a review cycle or record KPI
--    progress. Both are granted here.
-- 2. Department managers record KPI progress for their own team. New
--    permission hrms.kpi.progress, granted to DEPT_MANAGER (plus OWNER and
--    SUPER_ADMIN, which must hold every permission). The API
--    limits it to the caller's team (the same team as the My team page), so a
--    manager cannot touch anyone else's KPIs, and cannot create or delete KPIs.
--
-- Team scoping of reviews / cycle progress / KPIs for managers is in code
-- (PerformanceTeamScope); no data changes are needed for it.
--
-- Numbered 143.9 so it cannot collide with a teammate's V144. Idempotent.

INSERT INTO rbac.permissions (code, display_name, module, description)
     VALUES ('hrms.kpi.progress', 'Record team KPI progress',
             'hrms', 'Record progress on the KPIs of people in your own team')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
 CROSS JOIN (VALUES ('hrms.performance.read'), ('hrms.performance.write')) AS p(code)
 WHERE r.tenant_id IS NULL
   AND r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- DEPT_MANAGER for their team; OWNER and SUPER_ADMIN because they hold every
-- non-platform permission (OwnerPermissionInvariantCheck refuses to start the
-- app otherwise). Admin / HR already record any KPI via hrms.performance.write.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.kpi.progress'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('DEPT_MANAGER', 'OWNER', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;
