-- ============================================================================
-- V015 - CHECK constraint for settings.notification_templates.enabled_channels
-- ============================================================================
-- V013 converted the column from settings.notification_channel[] to
-- VARCHAR(30)[]. V014 added scalar CHECK constraints; the array column
-- needs its own check that verifies EVERY element is in the allowed set.
--
-- Pattern: enabled_channels <@ ARRAY[...]::VARCHAR[] (every element of LHS is
-- a member of the allowed set RHS). Empty arrays are allowed.
-- ============================================================================

ALTER TABLE settings.notification_templates
  ADD CONSTRAINT ck_notification_templates_enabled_channels
    CHECK (
      enabled_channels IS NULL
      OR enabled_channels <@ ARRAY['EMAIL','SMS','WHATSAPP','PUSH','IN_APP']::VARCHAR[]
    );
