-- V143.1 — department managers no longer read job offers.
--
-- Found by the 2026-09-24 post-deploy review (RG-3): every DEPT_MANAGER could
-- list every offer in the company — offered salary, internal notes and the
-- candidate's personal email — because V130 seeded hrms.hiring.offer.read to
-- the role and the offer endpoints also accepted plain hrms.hiring.read.
-- Offers are HR's; managers keep the hiring pipeline (hrms.hiring.read,
-- candidate.write). The endpoints now require offer.read itself.
--
-- Numbered 143.1 so it cannot collide with a teammate's V144.
-- Idempotent.

DELETE FROM rbac.role_permissions rp
 USING rbac.roles r
 WHERE rp.role_id = r.id
   AND r.tenant_id IS NULL
   AND r.code = 'DEPT_MANAGER'
   AND rp.permission_code = 'hrms.hiring.offer.read';
