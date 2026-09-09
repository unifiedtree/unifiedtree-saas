-- V116 (2026-09-09) — narrow permission for reading OTHER people's skill records.
--
-- Background: the SPA's "Skill Matrix" tab (Learning Center) called three
-- endpoints that had no backend mapping at all, so the whole tab 404'd. Wiring
-- it up raised a gating question: the obvious permission, hrms.learning.read,
-- is held by EMPLOYEE (they need it to browse the training catalogue and
-- enrol). Reusing it for the skill matrix would have let any employee read
-- every colleague's proficiency scores and certifications the moment the tab
-- started working.
--
-- So reading someone else's skills gets its own permission. Employees read
-- their own record through GET /v1/learning/skills/me, which is gated on the
-- self permission they already hold.
--
-- Default grants follow the standing rule for this workspace: HR and admins
-- can see, department managers cannot, and the admin widens it per role from
-- Settings -> Roles & Permissions if they want managers to see their team's
-- skills. Registering the row in rbac.permissions is what makes it appear on
-- that screen, so nothing here is a permanent decision.

INSERT INTO rbac.permissions (code, display_name, module, description)
VALUES (
    'hrms.learning.skill.read',
    'View other employees'' skills',
    'learning',
    'Read the skill matrix and certifications of employees other than yourself. Employees can always read their own.'
)
ON CONFLICT (code) DO NOTHING;

-- Grant to the roles that legitimately review other people's capability today.
-- DEPT_MANAGER / MANAGER / EMPLOYEE / FINANCE_LEAD / SECURITY are deliberately
-- excluded — default deny, admin grants.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.learning.skill.read'
  FROM rbac.roles r
 WHERE r.code IN ('SUPER_ADMIN', 'OWNER', 'ADMIN', 'HR_MANAGER')
ON CONFLICT DO NOTHING;
