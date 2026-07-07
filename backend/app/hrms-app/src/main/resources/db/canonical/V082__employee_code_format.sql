-- ============================================================================
-- V082 - Per-company employee code auto-increment format
-- ----------------------------------------------------------------------------
-- Admin configures the shape of new employee codes in HR configuration:
--   employee_code_prefix        — the letter part (e.g. 'UNI')
--   employee_code_next_number   — the next number to use; a counter
--   employee_code_padding       — how many digits to pad to (3 → 001, 4 → 0001)
--
-- On employee creation, the backend atomically reads-and-increments
-- employee_code_next_number in a single UPDATE ... RETURNING statement, so
-- concurrent creations never collide. Changing the prefix later only affects
-- codes issued AFTER the change (existing rows are not renamed).
-- ============================================================================

ALTER TABLE settings.hr_configuration
    ADD COLUMN IF NOT EXISTS employee_code_prefix      VARCHAR(10) NOT NULL DEFAULT 'EMP',
    ADD COLUMN IF NOT EXISTS employee_code_next_number BIGINT      NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS employee_code_padding     INT         NOT NULL DEFAULT 4;

-- Sanity: prefix must be non-empty letters/digits (no dashes, no spaces), 1..10 chars.
-- Dash is the mandatory separator inserted by the backend at format time.
ALTER TABLE settings.hr_configuration
    ADD CONSTRAINT ck_hr_config_emp_prefix
    CHECK (employee_code_prefix ~ '^[A-Za-z0-9]{1,10}$');

-- Padding must be 1..8 (enough for 100M employees under padding 8).
ALTER TABLE settings.hr_configuration
    ADD CONSTRAINT ck_hr_config_emp_padding
    CHECK (employee_code_padding BETWEEN 1 AND 8);

-- next_number must be positive.
ALTER TABLE settings.hr_configuration
    ADD CONSTRAINT ck_hr_config_emp_next_number
    CHECK (employee_code_next_number > 0);

DO $$ BEGIN
    RAISE NOTICE 'Added employee_code_{prefix,next_number,padding} to settings.hr_configuration';
END $$;
