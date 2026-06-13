-- Align the attendance method CHECK constraints with the application's
-- CheckInMethod enum.
--
-- ROOT CAUSE of "Punch Out Failed: An unexpected error occurred" (HTTP 500):
-- the mobile sends checkOutMethod="GPS"; the app's CheckInMethod enum has GPS,
-- PIN, MANAGER_OVERRIDE and BIOMETRIC_DEVICE, but the original
-- ck_attendance_records_check_out_method constraint only allowed MANUAL,
-- FACE_RECOGNITION, BIOMETRIC_FINGERPRINT, MOBILE_GPS, KIOSK, GEO_FENCE, API.
-- Storing "GPS" therefore violated the CHECK constraint and the check-out
-- UPDATE failed with a 500. (Check-IN worked only because it sends
-- FACE_RECOGNITION, which happened to be in both sets.)
--
-- Fix: allow the UNION of the canonical values and the enum names on BOTH the
-- check-in and check-out method columns, so the DB accepts whatever the app
-- produces while keeping the canonical values valid.
--
-- NOTE: Flyway is DISABLED on the Railway production deploy
-- (SPRING_FLYWAY_ENABLED=false); production was fixed manually via psycopg.
-- This migration keeps fresh / local / Testcontainers databases consistent.

ALTER TABLE attendance.records DROP CONSTRAINT IF EXISTS ck_attendance_records_check_in_method;
ALTER TABLE attendance.records ADD CONSTRAINT ck_attendance_records_check_in_method
    CHECK (check_in_method IS NULL OR (check_in_method)::text = ANY (ARRAY[
        'MANUAL','FACE_RECOGNITION','BIOMETRIC_FINGERPRINT','MOBILE_GPS','KIOSK',
        'GEO_FENCE','API','GPS','PIN','MANAGER_OVERRIDE','BIOMETRIC_DEVICE'
    ]::varchar[]));

ALTER TABLE attendance.records DROP CONSTRAINT IF EXISTS ck_attendance_records_check_out_method;
ALTER TABLE attendance.records ADD CONSTRAINT ck_attendance_records_check_out_method
    CHECK (check_out_method IS NULL OR (check_out_method)::text = ANY (ARRAY[
        'MANUAL','FACE_RECOGNITION','BIOMETRIC_FINGERPRINT','MOBILE_GPS','KIOSK',
        'GEO_FENCE','API','GPS','PIN','MANAGER_OVERRIDE','BIOMETRIC_DEVICE'
    ]::varchar[]));
