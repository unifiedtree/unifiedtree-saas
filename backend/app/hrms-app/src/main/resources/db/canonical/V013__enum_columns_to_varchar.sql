-- ============================================================================
-- V013 - convert Postgres ENUM columns to VARCHAR
-- ============================================================================
-- Hibernate 6 binds @Enumerated(STRING) values as JDBC VARCHAR. Postgres
-- doesn't implicitly cast varchar -> custom enum type, so inserts fail.
-- VARCHAR + a CHECK constraint enforces the same domain with no Hibernate
-- type-mapping gymnastics. Drop the now-unused enum types.
-- ============================================================================

-- hrms.employees enum columns
ALTER TABLE hrms.employees ALTER COLUMN gender              TYPE VARCHAR(30) USING gender::text;
ALTER TABLE hrms.employees ALTER COLUMN employment_type     TYPE VARCHAR(30) USING employment_type::text;
ALTER TABLE hrms.employees ALTER COLUMN employment_status   TYPE VARCHAR(30) USING employment_status::text;

-- attendance enum columns
ALTER TABLE attendance.records ALTER COLUMN attendance_type   TYPE VARCHAR(30) USING attendance_type::text;
ALTER TABLE attendance.records ALTER COLUMN attendance_status TYPE VARCHAR(30) USING attendance_status::text;
ALTER TABLE attendance.records ALTER COLUMN check_in_method   TYPE VARCHAR(30) USING check_in_method::text;
ALTER TABLE attendance.records ALTER COLUMN check_out_method  TYPE VARCHAR(30) USING check_out_method::text;

ALTER TABLE attendance.event_logs ALTER COLUMN event_type        TYPE VARCHAR(30) USING event_type::text;
ALTER TABLE attendance.event_logs ALTER COLUMN attendance_status TYPE VARCHAR(30) USING attendance_status::text;

-- leave_mgmt enum columns
ALTER TABLE leave_mgmt.leave_requests ALTER COLUMN status TYPE VARCHAR(30) USING status::text;

-- settings enum columns
ALTER TABLE settings.holiday_calendar       ALTER COLUMN holiday_type     TYPE VARCHAR(30) USING holiday_type::text;
ALTER TABLE settings.notification_templates ALTER COLUMN enabled_channels TYPE VARCHAR(30)[] USING enabled_channels::text[];

-- platform enum columns
ALTER TABLE platform.tenants         ALTER COLUMN status    TYPE VARCHAR(30) USING status::text;
ALTER TABLE platform.tenants         ALTER COLUMN plan_type TYPE VARCHAR(30) USING plan_type::text;
ALTER TABLE platform.tenant_modules  ALTER COLUMN status    TYPE VARCHAR(30) USING status::text;

-- Drop the now-orphaned ENUM types (CASCADE clears any remaining references)
DROP TYPE IF EXISTS hrms.employment_type           CASCADE;
DROP TYPE IF EXISTS hrms.employment_status         CASCADE;
DROP TYPE IF EXISTS hrms.gender                    CASCADE;
DROP TYPE IF EXISTS attendance.attendance_type     CASCADE;
DROP TYPE IF EXISTS attendance.attendance_status   CASCADE;
DROP TYPE IF EXISTS attendance.check_method        CASCADE;
DROP TYPE IF EXISTS attendance.event_type          CASCADE;
DROP TYPE IF EXISTS leave_mgmt.leave_request_status CASCADE;
DROP TYPE IF EXISTS settings.holiday_type          CASCADE;
DROP TYPE IF EXISTS settings.notification_channel  CASCADE;
DROP TYPE IF EXISTS platform.tenant_status         CASCADE;
DROP TYPE IF EXISTS platform.plan_tier             CASCADE;
DROP TYPE IF EXISTS platform.module_status         CASCADE;
