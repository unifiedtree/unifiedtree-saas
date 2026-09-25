-- V143.34: take the product name out of a role description a customer can read.
--
-- rbac.roles.description for PLATFORM_SUPER_ADMIN read "UnifiedTree
-- platform-level administrator...", and the workspace Roles & permissions page
-- listed every role, so a customer saw the vendor's name inside their own
-- workspace. RbacService now hides PLATFORM_* roles from anyone without
-- platform.admin; this also rewords the text so nothing leaks if it is ever
-- rendered somewhere else. Idempotent.

UPDATE rbac.roles
   SET description = 'Platform-level administrator. Approves new workspaces and turns modules on.'
 WHERE code = 'PLATFORM_SUPER_ADMIN'
   AND description IS DISTINCT FROM 'Platform-level administrator. Approves new workspaces and turns modules on.';
