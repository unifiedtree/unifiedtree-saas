ALTER TABLE learning_mgmt.employee_skills ADD COLUMN IF NOT EXISTS expires_on DATE;
ALTER TABLE learning_mgmt.employee_skills ADD CONSTRAINT chk_skill_certification_dates
    CHECK (expires_on IS NULL OR certified_on IS NULL OR expires_on >= certified_on);
