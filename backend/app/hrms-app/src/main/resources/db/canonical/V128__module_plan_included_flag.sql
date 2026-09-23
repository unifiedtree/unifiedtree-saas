-- ModulePlanService and the public catalog DTO already read this flag, but
-- the canonical schema never added it. Existing paid catalog rows retain
-- their pricing; no module becomes free or activated by this schema repair.
ALTER TABLE platform.module_plans
    ADD COLUMN IF NOT EXISTS is_included BOOLEAN NOT NULL DEFAULT FALSE;
