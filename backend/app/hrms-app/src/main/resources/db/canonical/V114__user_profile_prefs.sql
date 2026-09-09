-- ============================================================================
-- V114 — Per-user profile prefs (display_name override + notification prefs)
-- ============================================================================
--
-- Context: the Profile page (`apps/platform/src/pages/Profile.tsx`) has been
-- broken for months. The audit on 2026-09-08 pinned it on a full contract
-- mismatch:
--   * GET /v1/users/me returned userId / display_name / avatar_url; the SPA
--     reads user.id / user.displayName / user.avatarUrl.
--   * No PUT /v1/users/me handler existed at all — every Save 404'd.
--   * phone + notificationPreferences had no column to land in.
--
-- This migration adds the two columns the Save flow needs. Backend changes
-- in the same commit (UserProfileController) switch the GET response to
-- camelCase and add the PUT endpoint. mobile_number is reused for phone.
--
-- Reversible: safe to drop these columns to roll back — nothing else in the
-- app currently reads them.

ALTER TABLE auth.user_credentials
    ADD COLUMN IF NOT EXISTS display_name             VARCHAR(150),
    ADD COLUMN IF NOT EXISTS notification_preferences JSONB;

-- Optional: seed the JSONB with the current defaults so the first GET after
-- deploy returns a stable object rather than null (the SPA already coalesces
-- ?? true, but a null->{} normalise keeps the API contract clean).
UPDATE auth.user_credentials
   SET notification_preferences = jsonb_build_object('emailEnabled', true, 'pushEnabled', true)
 WHERE notification_preferences IS NULL;
