-- V143 — a shift-change request takes effect on the date the employee chose.
--
-- Client acceptance case #2 (2026-09-24): the employee picks the date their
-- new shift should start, but the request row had nowhere to keep it, and
-- approval always assigned the shift from the approver's "today". A request
-- for Monday approved on Thursday started on Thursday.
--
-- requested_effective_date — the start date the employee asked for. NULL on
--   rows created before this migration and on requests from app builds that
--   predate the date field; for those the approver chooses the date.
-- applied_effective_date   — the date the new shift actually started, set on
--   approval. It differs from the requested date only when that date had
--   already passed before the request was approved and the approver chose a
--   new one (the employee is told the real date).
--
-- New columns inherit the table-level grants V142 gave ut_app.
--
-- Everything here is idempotent.

ALTER TABLE attendance.shift_change_requests
    ADD COLUMN IF NOT EXISTS requested_effective_date DATE,
    ADD COLUMN IF NOT EXISTS applied_effective_date   DATE;

-- Approvals made before this migration assigned the shift from the IST
-- calendar date of the decision (EmployeeShiftService.assignShift with no
-- date), so that is their true applied date.
UPDATE attendance.shift_change_requests
   SET applied_effective_date = (decided_at AT TIME ZONE 'Asia/Kolkata')::date
 WHERE status = 'APPROVED'
   AND applied_effective_date IS NULL
   AND decided_at IS NOT NULL;

-- One pending request per employee was enforced only in code (count, then
-- insert), so a double submit could store two. Production had no duplicates
-- when this was written.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scr_one_pending_per_employee
    ON attendance.shift_change_requests (tenant_id, employee_id)
    WHERE status = 'PENDING';
