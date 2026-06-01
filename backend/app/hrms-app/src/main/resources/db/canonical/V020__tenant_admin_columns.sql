-- ============================================================================
-- V020 - SaaS portal: tenant request lifecycle columns
-- ============================================================================
-- Extends platform.tenants so PlatformSaasController can list tenant requests
-- with admin contact info without joining auth.user_credentials under RLS,
-- and so the rejection path has a place to store the reason.
--
-- Also widens the status CHECK to allow REJECTED as a terminal state
-- distinct from TERMINATED (which applies to previously-active tenants).
-- ============================================================================

ALTER TABLE platform.tenants
  ADD COLUMN IF NOT EXISTS admin_name        VARCHAR(150),
  ADD COLUMN IF NOT EXISTS rejected_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by       UUID,
  ADD COLUMN IF NOT EXISTS rejection_reason  TEXT;

-- Replace the V014 status check to allow REJECTED.
ALTER TABLE platform.tenants DROP CONSTRAINT IF EXISTS ck_tenants_status;
ALTER TABLE platform.tenants
  ADD CONSTRAINT ck_tenants_status
    CHECK (status IN ('PENDING_APPROVAL','ACTIVE','REJECTED','SUSPENDED','TERMINATED'));
