-- ============================================================================
-- V103__user_avatar_url.sql
--
-- Add avatar_url to auth.user_credentials.
--
-- The task brief called for platform.tenant_users.avatar_url, but this
-- codebase does not have a platform.tenant_users table — the per-workspace
-- user record lives in auth.user_credentials (see V003). Adding the column
-- there keeps the avatar on the same row that already carries email,
-- employee_id and last_login_at, which is what UserAvatarController writes
-- and /v1/users/me reads.
--
-- The column is nullable — a workspace user without a photo simply returns
-- null, and the SPA renders its initials-based fallback.
-- ============================================================================

ALTER TABLE auth.user_credentials
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN auth.user_credentials.avatar_url IS
    'Public URL to the user''s profile avatar (uploaded via '
    'POST /v1/users/me/avatar). NULL means no avatar set — the SPA renders '
    'an initials-based fallback.';
