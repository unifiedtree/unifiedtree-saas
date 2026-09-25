-- V143.32: recompute stored overtime against each person's shift.
--
-- Until 2026-09-25 overtime_minutes was anything past a fixed 8 clock hours, so
-- a normal 09:30-18:30 day (9 h incl. break) showed 60 minutes of overtime for
-- everyone. AttendanceService now uses the shift length (or the shift's working
-- hours, whichever is longer). This rewrites stored values for records whose
-- overtime nobody has approved or rejected yet; decided records are left as they
-- are. People without a shift assignment keep the 8-hour rule. Idempotent.

WITH thresholds AS (
    SELECT r.id, r.attendance_date,
           GREATEST(
               CASE WHEN sp.end_time > sp.start_time
                    THEN EXTRACT(EPOCH FROM (sp.end_time - sp.start_time)) / 3600.0
                    ELSE EXTRACT(EPOCH FROM (sp.end_time - sp.start_time)) / 3600.0 + 24 END,
               COALESCE(sp.working_hours_per_day, 0)) AS threshold_hours
      FROM attendance.records r
      JOIN LATERAL (
            SELECT sp.start_time, sp.end_time, sp.working_hours_per_day
              FROM attendance.employee_shift_assignments esa
              JOIN attendance.shift_policies sp ON sp.id = esa.shift_policy_id
             WHERE esa.employee_id = r.employee_id
               AND esa.effective_from <= r.attendance_date
               AND (esa.effective_to IS NULL OR esa.effective_to >= r.attendance_date)
               AND sp.is_active = TRUE
             ORDER BY esa.effective_from DESC
             LIMIT 1) sp ON TRUE
     WHERE r.work_hours IS NOT NULL
       AND sp.start_time IS NOT NULL AND sp.end_time IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM attendance.overtime_decisions od WHERE od.record_id = r.id)
)
UPDATE attendance.records r
   SET overtime_minutes = GREATEST(0, ROUND((r.work_hours - t.threshold_hours) * 60))::int
  FROM thresholds t
 WHERE r.id = t.id AND r.attendance_date = t.attendance_date
   AND r.overtime_minutes IS DISTINCT FROM GREATEST(0, ROUND((r.work_hours - t.threshold_hours) * 60))::int;
