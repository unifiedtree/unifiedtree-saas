-- V080: Reconcile attendance CHECK constraints with the current Java enums.
--
-- The Java enums drifted from the original CHECK constraints, so any write whose
-- value the stale constraint didn't list rolled back the whole transaction -> HTTP 500:
--   * AttendanceEventType.MANUAL_ENTRY / CORRECTION_REQUESTED / CORRECTION_APPROVED /
--     CORRECTION_REJECTED  -> ck_event_logs_event_type only allowed REGULARIZATION_* /
--     MANUAL_OVERRIDE  => every manual-entry and correction 500'd.
--   * AttendanceStatus.ON_TIME / WFH / NOT_MARKED  -> not in the status CHECKs
--     => on-time self check-in (computes ON_TIME) and WFH 500'd.
--   * AttendanceType.WFH / FIELD_WORK / ON_LEAVE / HOLIDAY / HALF_DAY  -> not in the
--     type CHECK (which had WORK_FROM_HOME/HYBRID/FIELD/OUTDOOR_DUTY) => those 500'd.
--
-- Fix: redefine each constraint as the UNION of the legacy values (so existing rows
-- still validate) and the current Java enum values (so new writes pass). The Java
-- enums are the source of truth; the DB constraints catch up here.

ALTER TABLE attendance.records DROP CONSTRAINT IF EXISTS ck_attendance_records_attendance_status;
ALTER TABLE attendance.records ADD CONSTRAINT ck_attendance_records_attendance_status
  CHECK (attendance_status IS NULL OR attendance_status IN (
    'ON_TIME','LATE','PRESENT','ABSENT','HALF_DAY','ON_LEAVE','HOLIDAY','WEEKEND','WFH','NOT_MARKED',
    'PENDING_REGULARIZATION'));

ALTER TABLE attendance.records DROP CONSTRAINT IF EXISTS ck_attendance_records_attendance_type;
ALTER TABLE attendance.records ADD CONSTRAINT ck_attendance_records_attendance_type
  CHECK (attendance_type IS NULL OR attendance_type IN (
    'OFFICE','WFH','FIELD_WORK','ON_LEAVE','HOLIDAY','HALF_DAY',
    'WORK_FROM_HOME','HYBRID','FIELD','OUTDOOR_DUTY'));

ALTER TABLE attendance.event_logs DROP CONSTRAINT IF EXISTS ck_event_logs_attendance_status;
ALTER TABLE attendance.event_logs ADD CONSTRAINT ck_event_logs_attendance_status
  CHECK (attendance_status IS NULL OR attendance_status IN (
    'ON_TIME','LATE','PRESENT','ABSENT','HALF_DAY','ON_LEAVE','HOLIDAY','WEEKEND','WFH','NOT_MARKED',
    'PENDING_REGULARIZATION'));

ALTER TABLE attendance.event_logs DROP CONSTRAINT IF EXISTS ck_event_logs_event_type;
ALTER TABLE attendance.event_logs ADD CONSTRAINT ck_event_logs_event_type
  CHECK (event_type IN (
    'CHECK_IN','CHECK_OUT','BREAK_START','BREAK_END',
    'MANUAL_ENTRY','CORRECTION_REQUESTED','CORRECTION_APPROVED','CORRECTION_REJECTED',
    'REGULARIZATION_REQUEST','REGULARIZATION_APPROVED','REGULARIZATION_REJECTED','MANUAL_OVERRIDE'));
