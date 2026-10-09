-- ============================================================================
-- V144_6 - "Can buy and manage plans and billing" (owner, Q-26, 9 Oct 2026)
-- ============================================================================
-- The owner hands billing to someone else by ticking ONE permission on any
-- custom role (or giving it to one person): workspace.billing.manage. The plan,
-- seats, autopay, module buying and billing-by-company endpoints and the web
-- (menu, /plan, Billing tab, upsell) all check it now (before, the plan
-- endpoints read tenant.settings.write and the web read role names).
-- This file only renames it in the Roles editor so the owner can find it;
-- who holds it does not change. Still CRITICAL: only an owner can give it.
--
-- ── Applying by hand (Flyway is OFF in production) ─────────────────────────────
-- Any time (the code works with the old name too). As the owner role, one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f V144_6__billing_permission_name.sql
-- lock_timeout = 5s (one row update). Idempotent.
-- Rollback: set display_name / description back to the V035 / V143_17_1 values:
--   'Manage billing and subscription settings' /
--   'See how many seats are used and manage the workspace''s billing.'
-- ============================================================================

SET LOCAL lock_timeout = '5s';

UPDATE rbac.permissions
   SET display_name = 'Can buy and manage plans and billing',
       description  = 'Buy modules and seats, set up, change or cancel autopay and the plan, and see billing by company.'
 WHERE code = 'workspace.billing.manage';
