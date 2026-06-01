-- ============================================================================
-- V016 - add BaseEntity audit columns to auth.* tables
-- ============================================================================
-- V011 added created_by / updated_by / version to org / hrms / settings, but
-- not to the auth schema since auth entities were not yet using BaseEntity.
-- The canonical UserCredentials + RefreshToken entities now extend BaseEntity,
-- so the schema must match. Idempotent.
-- ============================================================================

-- auth.user_credentials -- already has created_at, last_login_at etc.; missing audit triplet
ALTER TABLE auth.user_credentials ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE auth.user_credentials ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE auth.user_credentials ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

-- auth.refresh_tokens -- V003 only has issued_at, expires_at, revoked_at
ALTER TABLE auth.refresh_tokens   ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE auth.refresh_tokens   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE auth.refresh_tokens   ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE auth.refresh_tokens   ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE auth.refresh_tokens   ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;
