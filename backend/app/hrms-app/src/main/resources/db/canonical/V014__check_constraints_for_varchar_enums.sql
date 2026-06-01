-- ============================================================================
-- V014 - CHECK constraints for V013 VARCHAR-replaced enum columns
-- ============================================================================
-- V013 converted Postgres ENUM columns to VARCHAR(30) for Hibernate
-- compatibility, but did not add CHECK constraints. Without these, the DB
-- layer accepts any string -- the only validation is in Java.
--
-- This migration adds per-column CHECK constraints that enforce the same
-- value domain the original ENUM types did. Each constraint must be kept
-- in sync with the corresponding Java enum: if a new value is added in code,
-- a new V0xx migration must extend the CHECK.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- hrms.employees
-- ---------------------------------------------------------------------------
ALTER TABLE hrms.employees
  ADD CONSTRAINT ck_employees_gender
    CHECK (gender IS NULL OR gender IN
      ('MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY'));

ALTER TABLE hrms.employees
  ADD CONSTRAINT ck_employees_employment_type
    CHECK (employment_type IN
      ('FULL_TIME','PART_TIME','CONTRACT','INTERN','CONSULTANT'));

ALTER TABLE hrms.employees
  ADD CONSTRAINT ck_employees_employment_status
    CHECK (employment_status IN
      ('PROBATION','ACTIVE','NOTICE_PERIOD','SUSPENDED','EXITED','TERMINATED'));

-- ---------------------------------------------------------------------------
-- attendance.records
-- ---------------------------------------------------------------------------
ALTER TABLE attendance.records
  ADD CONSTRAINT ck_attendance_records_attendance_type
    CHECK (attendance_type IS NULL OR attendance_type IN
      ('OFFICE','WORK_FROM_HOME','HYBRID','FIELD','OUTDOOR_DUTY'));

ALTER TABLE attendance.records
  ADD CONSTRAINT ck_attendance_records_attendance_status
    CHECK (attendance_status IS NULL OR attendance_status IN
      ('PRESENT','ABSENT','LATE','HALF_DAY','ON_LEAVE','WEEKEND','HOLIDAY','PENDING_REGULARIZATION'));

ALTER TABLE attendance.records
  ADD CONSTRAINT ck_attendance_records_check_in_method
    CHECK (check_in_method IS NULL OR check_in_method IN
      ('MANUAL','FACE_RECOGNITION','BIOMETRIC_FINGERPRINT','MOBILE_GPS','KIOSK','GEO_FENCE','API'));

ALTER TABLE attendance.records
  ADD CONSTRAINT ck_attendance_records_check_out_method
    CHECK (check_out_method IS NULL OR check_out_method IN
      ('MANUAL','FACE_RECOGNITION','BIOMETRIC_FINGERPRINT','MOBILE_GPS','KIOSK','GEO_FENCE','API'));

-- ---------------------------------------------------------------------------
-- attendance.event_logs
-- ---------------------------------------------------------------------------
ALTER TABLE attendance.event_logs
  ADD CONSTRAINT ck_event_logs_event_type
    CHECK (event_type IN
      ('CHECK_IN','CHECK_OUT','BREAK_START','BREAK_END',
       'REGULARIZATION_REQUEST','REGULARIZATION_APPROVED','REGULARIZATION_REJECTED',
       'MANUAL_OVERRIDE'));

ALTER TABLE attendance.event_logs
  ADD CONSTRAINT ck_event_logs_attendance_status
    CHECK (attendance_status IS NULL OR attendance_status IN
      ('PRESENT','ABSENT','LATE','HALF_DAY','ON_LEAVE','WEEKEND','HOLIDAY','PENDING_REGULARIZATION'));

-- ---------------------------------------------------------------------------
-- leave_mgmt.leave_requests
-- ---------------------------------------------------------------------------
ALTER TABLE leave_mgmt.leave_requests
  ADD CONSTRAINT ck_leave_requests_status
    CHECK (status IN
      ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED','WITHDRAWN'));

-- ---------------------------------------------------------------------------
-- settings.holiday_calendar
-- ---------------------------------------------------------------------------
ALTER TABLE settings.holiday_calendar
  ADD CONSTRAINT ck_holiday_type
    CHECK (holiday_type IN
      ('NATIONAL','FESTIVAL','RESTRICTED','REGIONAL','OPTIONAL','COMPANY'));

-- ---------------------------------------------------------------------------
-- platform.tenants
-- ---------------------------------------------------------------------------
ALTER TABLE platform.tenants
  ADD CONSTRAINT ck_tenants_status
    CHECK (status IN
      ('PENDING_APPROVAL','ACTIVE','SUSPENDED','TERMINATED'));

ALTER TABLE platform.tenants
  ADD CONSTRAINT ck_tenants_plan_type
    CHECK (plan_type IN
      ('STARTER','PROFESSIONAL','ENTERPRISE'));

-- ---------------------------------------------------------------------------
-- platform.tenant_modules
-- ---------------------------------------------------------------------------
ALTER TABLE platform.tenant_modules
  ADD CONSTRAINT ck_tenant_modules_status
    CHECK (status IN
      ('REQUESTED','APPROVED','ACTIVE','SUSPENDED','EXPIRED'));
