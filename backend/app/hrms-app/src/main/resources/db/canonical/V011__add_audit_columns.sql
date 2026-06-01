-- ============================================================================
-- V011 - audit columns required by BaseEntity
-- ============================================================================
-- BaseEntity (shared by every canonical JPA entity) maps these fields:
--   created_at  TIMESTAMPTZ
--   updated_at  TIMESTAMPTZ
--   created_by  VARCHAR
--   updated_by  VARCHAR
--   version     BIGINT  (optimistic lock counter)
-- V005..V010 covered created_at / updated_at. This migration adds the rest
-- to every table whose entity extends BaseEntity. Idempotent via IF NOT EXISTS.
-- ============================================================================

-- org schema
ALTER TABLE org.companies        ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE org.companies        ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE org.companies        ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE org.branches         ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE org.branches         ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE org.branches         ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE org.geofence_zones   ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE org.geofence_zones   ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE org.geofence_zones   ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE org.geofence_zones   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- hrms schema
ALTER TABLE hrms.departments     ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE hrms.departments     ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.departments     ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE hrms.designations    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE hrms.designations    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.designations    ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE hrms.employees       ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE hrms.employees       ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.employees       ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE hrms.contractors     ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE hrms.contractors     ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.contractors     ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE hrms.classification_rules ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE hrms.classification_rules ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE hrms.classification_rules ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hrms.classification_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- settings schema
ALTER TABLE settings.hr_configuration ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE settings.hr_configuration ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE settings.hr_configuration ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE settings.holiday_calendar ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE settings.holiday_calendar ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE settings.holiday_calendar ADD COLUMN IF NOT EXISTS version    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE settings.holiday_calendar ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
