-- V118 (2026-09-10) — persist the department colour + icon the admin picks.
--
-- The Add Department drawer offered 8 colour swatches and 4 icons. Both were
-- stored in the admin's own localStorage under keys 'dept_color_<id>' and
-- 'dept_icon_<id>' — so the admin who created the department saw the colour,
-- and every other user, device, or private-window session saw the default
-- green. It read as a saved org setting; it was per-browser. Icons were even
-- worse: writeDeptIcon was called on save, but no code path ever READ that
-- key from any table, list or picker — the chosen icon had zero observable
-- effect anywhere.
--
-- Add the columns so the choice is a real tenant preference. Both nullable:
-- pre-existing rows keep the current default until an admin edits them, and
-- callers that omit the fields on create do not need to change.

ALTER TABLE hrms.departments
    ADD COLUMN IF NOT EXISTS color_hex VARCHAR(9),  -- '#RRGGBB' or '#RRGGBBAA'
    ADD COLUMN IF NOT EXISTS icon_key  VARCHAR(40);
