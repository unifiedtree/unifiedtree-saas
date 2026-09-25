-- V143.25: attendance extras (overtime reason, shift assignment note).
--
-- 1. attendance.records.overtime_reason: why the employee stayed past their
--    shift. Captured when the mobile app sends `overtimeReason` on check-out,
--    or later by the employee through PUT /v1/attendance/overtime/{id}/reason
--    while the overtime is still waiting for a decision. The overtime list
--    (GET /v1/attendance/overtime) returns it with the shift end and the
--    check-out time. Read and written with JDBC only (not mapped on the JPA
--    entity), so the entity is unchanged.
--    attendance.records is partitioned: ADD COLUMN on the parent reaches every
--    partition, including ones created later.
--
-- 2. attendance.employee_shift_assignments.note: the note HR types in the
--    Change-shift drawer ("Swapped with Vikram for the quarter"), kept with the
--    assignment and shown in the employee's shift history
--    (GET /v1/shifts/employee/{id}/history). Assignments made by approving a
--    shift change request carry the employee's reason.
--
-- No new tables, permissions or policies: both tables already have RLS and
-- ut_app grants. Numbered 143.25 so it cannot collide with a teammate's V144.
-- Idempotent.

ALTER TABLE attendance.records
    ADD COLUMN IF NOT EXISTS overtime_reason VARCHAR(500);

COMMENT ON COLUMN attendance.records.overtime_reason IS
    'Why the employee worked past their shift end; given at check-out or later while the overtime is pending.';

ALTER TABLE attendance.employee_shift_assignments
    ADD COLUMN IF NOT EXISTS note VARCHAR(500);

COMMENT ON COLUMN attendance.employee_shift_assignments.note IS
    'Why this shift was assigned (typed by HR in the Change-shift drawer, or the reason on an approved shift change request).';
