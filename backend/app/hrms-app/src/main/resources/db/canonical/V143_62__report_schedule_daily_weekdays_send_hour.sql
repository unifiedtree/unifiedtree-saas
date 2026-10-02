-- V143.62: report emails every day or every weekday, at a chosen hour
-- (redesign P-REPORTS, BW-89).
--
-- hrms.report_schedules (V143.27) is read and written with JDBC only
-- (ReportScheduleService); no JPA entity maps it, so ddl-auto=validate never
-- looks at it.
--
-- 1. ck_report_schedules_frequency: DAILY and WEEKDAYS join WEEKLY and MONTHLY.
--    A daily email covers the day before it; a weekday email (Monday to Friday)
--    covers the days since the previous weekday (Monday's covers Friday to
--    Sunday).
-- 2. ck_report_schedules_day: a daily or weekday email names no day; weekly
--    still needs its weekday and monthly its day of the month, as before.
-- 3. send_hour SMALLINT NULL: the hour (India time, 7 to 23) the email goes
--    out. NULL keeps today's behaviour: the first run of the day (07:05 IST).
--    ReportScheduleJob runs at five past every hour from 07:05 to 23:05, so an
--    email set for 11 goes out at 11:05. Every existing row stays NULL.
--
-- Every email also carries the report's CSV next to the PDF (no schema change).
--
-- Until this file is applied the app keeps working: weekly and monthly emails
-- go out as before, and choosing "every day", "every weekday" or a send time
-- answers 503 FEATURE_NOT_READY ("This isn't switched on yet.").
--
-- No new permission (hrms.report.schedule.manage, V143.27, still decides who
-- may set emails up). No JPA-mapped column is added or changed.
--
-- Idempotent: each constraint is replaced only while it still lacks the new
-- values, and the column is added only when missing. The table is small (a few
-- rows per workspace), so the swap is a plain DROP + ADD inside one DO block.
-- Production has Flyway OFF: apply by hand, after V143.27, as a superuser.

-- ── 1. frequency ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'hrms.report_schedules'::regclass
                      AND conname = 'ck_report_schedules_frequency'
                      AND pg_get_constraintdef(oid) LIKE '%WEEKDAYS%') THEN
        ALTER TABLE hrms.report_schedules DROP CONSTRAINT IF EXISTS ck_report_schedules_frequency;
        ALTER TABLE hrms.report_schedules
            ADD CONSTRAINT ck_report_schedules_frequency
            CHECK (frequency IN ('WEEKLY', 'MONTHLY', 'DAILY', 'WEEKDAYS'));
    END IF;
END $$;

-- ── 2. the day each frequency needs ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'hrms.report_schedules'::regclass
                      AND conname = 'ck_report_schedules_day'
                      AND pg_get_constraintdef(oid) LIKE '%WEEKDAYS%') THEN
        ALTER TABLE hrms.report_schedules DROP CONSTRAINT IF EXISTS ck_report_schedules_day;
        ALTER TABLE hrms.report_schedules
            ADD CONSTRAINT ck_report_schedules_day
            CHECK ((frequency = 'WEEKLY' AND day_of_week IS NOT NULL)
                OR (frequency = 'MONTHLY' AND day_of_month IS NOT NULL)
                OR (frequency IN ('DAILY', 'WEEKDAYS') AND day_of_week IS NULL AND day_of_month IS NULL));
    END IF;
END $$;

-- ── 3. send hour ────────────────────────────────────────────────────────────
ALTER TABLE hrms.report_schedules
    ADD COLUMN IF NOT EXISTS send_hour SMALLINT;

COMMENT ON COLUMN hrms.report_schedules.send_hour IS
    'Hour (IST, 7-23) the email goes out; NULL = the first run of the day, 07:05 IST (V143.62). JDBC only.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'hrms.report_schedules'::regclass
                      AND conname = 'ck_report_schedules_send_hour') THEN
        ALTER TABLE hrms.report_schedules
            ADD CONSTRAINT ck_report_schedules_send_hour
            CHECK (send_hour IS NULL OR send_hour BETWEEN 7 AND 23);
    END IF;
END $$;
