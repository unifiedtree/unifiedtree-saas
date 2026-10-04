-- V143.69: date each permission, and remember when a business last reviewed its own
-- roles, so its admin can be told about permissions added since.
--
-- Why. Every new permission ships to BUILT-IN roles only: migrations grant it
-- WHERE r.tenant_id IS NULL (V143.55, V143.56, V143.57, V143.65, V143.67 ...).
-- Roles a business made itself (tenant_id set) deliberately get nothing
-- automatically, because we can't know what they are for. But nobody was told,
-- so the people holding those roles silently never got the new features. The
-- Roles & permissions page now shows "N new permissions available — Review" on
-- such a role; this file gives it the two dates it needs:
--   * rbac.permissions.added_at — when the permission joined the catalogue.
--     NULL means it existed before this tracking began and is never "new".
--   * rbac.roles.permissions_reviewed_at — when an admin last marked the role
--     as reviewed. NULL means never; the role's created_at is used instead.
-- A permission is "new" for a business-made role when added_at is later than
-- COALESCE(permissions_reviewed_at, created_at) and the role doesn't hold it.
--
-- How. added_at is added WITHOUT a default first, so every existing row stays
-- NULL; only then does it get DEFAULT now(), so permissions inserted from now on
-- are dated by their own migration. (Adding the column WITH DEFAULT now() would
-- stamp every existing permission as new — don't.)
--
-- Release 2 (applied 2 Oct 2026) added five permissions, which are backfilled
-- with that date so roles made before Release 2 are told about them. The list is
-- every code INSERTed into rbac.permissions by V143.50 to V143.66 (V143.50,
-- .52-.54, .58-.62 and .66 add none; there is no .51, .63 or .64):
--   * hrms.probation.team.decide   — V143.55
--   * hrms.team.message            — V143.55
--   * hrms.leave.apply.others      — V143.56
--   * hrms.expense.claim.others    — V143.57
--   * hrms.timesheet.approve       — V143.65
-- The backfill only fills a NULL, so re-running it never moves a date.
--
-- Safety. Purely additive: two nullable columns no JPA entity maps (Permission
-- and Role keep validating), one default, one backfill. No grant changes, no
-- permission is added or removed, so OwnerPermissionInvariantCheck is
-- unaffected. The code reads both columns only after checking they exist, so
-- until this is applied the page simply shows no notice.
--
-- Numbered 143.69: V143.68 is the latest (Flyway compares versions numerically,
-- so 143.69 sorts after 143.68 and reuses nothing). Idempotent.
-- Production has Flyway OFF: apply by hand, as the table's owner.

ALTER TABLE rbac.permissions ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;
ALTER TABLE rbac.permissions ALTER COLUMN added_at SET DEFAULT now();

COMMENT ON COLUMN rbac.permissions.added_at IS
    'When the permission joined the catalogue. NULL = existed before V143.69 (never shown as new to a business-made role).';

UPDATE rbac.permissions
   SET added_at = '2026-10-02'
 WHERE added_at IS NULL
   AND code IN (
        'hrms.probation.team.decide',
        'hrms.team.message',
        'hrms.leave.apply.others',
        'hrms.expense.claim.others',
        'hrms.timesheet.approve'
   );

ALTER TABLE rbac.roles ADD COLUMN IF NOT EXISTS permissions_reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN rbac.roles.permissions_reviewed_at IS
    'When an admin last marked this business-made role''s new permissions as reviewed. NULL = never (created_at is used).';
