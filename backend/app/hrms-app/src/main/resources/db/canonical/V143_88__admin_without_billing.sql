-- V143.88: the built-in Admin role no longer manages billing
-- (workspace.billing.manage).
--
-- Why. The owner decided on 2026-10-05 that Admin is "the owner minus
-- billing": plans, payment methods, invoices and autopay belong to the Owner.
-- The web already hides Billing & Plan and the danger zone from Admin, but
-- V109 and V143_18 left ADMIN holding workspace.billing.manage, which is what
-- guards /settings/billing and the billing API, so an Admin who typed the
-- address could still open it.
--
-- Safety. Removes one grant from one built-in role (tenant_id IS NULL).
-- OWNER and SUPER_ADMIN keep workspace.billing.manage, so every workspace still
-- has someone who can pay (OwnerPermissionInvariantCheck only checks OWNER).
-- Roles a business made itself, and per-person grants, are untouched: an owner
-- who wants an admin to handle billing clones the Admin role and adds it.
-- People pick the change up at their next sign-in or token refresh. No data is
-- deleted. A future migration that copies OWNER's grants onto ADMIN (as V143_18,
-- V143_19 and V143_33 did) must exclude workspace.billing.manage as well.
--
-- Numbered 143.88 (reserved slot in 143.70-143.88). Idempotent: a re-run
-- deletes nothing.
-- Production has Flyway OFF: apply by hand, as the table owner.

DELETE FROM rbac.role_permissions rp
 USING rbac.roles r
 WHERE rp.role_id = r.id
   AND r.tenant_id IS NULL
   AND r.code = 'ADMIN'
   AND rp.permission_code = 'workspace.billing.manage';
