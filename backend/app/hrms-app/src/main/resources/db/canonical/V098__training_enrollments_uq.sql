-- ============================================================================
-- V098 - learning_mgmt.training_enrollments unique (program, employee)
--        (Audit Bundle B9, 2026-08-14)
-- ----------------------------------------------------------------------------
-- Finding addressed:
--
--   B9-4  training-enrollment-duplicate-rows
--         learning_mgmt.training_enrollments (added in V073) has no unique
--         constraint on (program_id, employee_id). The enrollment endpoint
--         guards the duplicate case in Java, but a double-click, two-tab
--         re-post, or any race between REST and the CSV bulk import can
--         land two ENROLLED rows for the same employee on the same program.
--         The completion-rate calculation counts each row, so a duplicate
--         inflates both the numerator and the "enrolled" count and skews
--         the program dashboard.
--
--         Fix: partial-index-less plain UNIQUE index — every enrollment
--         must be unique on (program_id, employee_id) regardless of status
--         (a re-enrollment after DROPPED is not a supported workflow; HR
--         re-opens the existing row instead of creating a new one).
--
-- ----------------------------------------------------------------------------
-- APPLICATION MODEL:
--   Flyway is disabled on the live backend. This file is the record of
--   intent; the operator MUST APPLY IT MANUALLY VIA PSYCOPG in a quiet
--   window (SET LOCAL lock_timeout='2s' recommended) — see
--   scripts/apply_v097_v098_v099.py.
--
--   Data pre-check: CREATE UNIQUE INDEX will fail with 23505
--   (unique_violation) if duplicate (program_id, employee_id) rows already
--   exist. The apply script SELECTs the offending rows first so operators
--   can dedupe before the index build takes a lock.
--
--   Rollback:
--     DROP INDEX IF EXISTS learning_mgmt.uq_training_enrollments_program_employee;
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_training_enrollments_program_employee
    ON learning_mgmt.training_enrollments (program_id, employee_id);

-- ── Verification log ───────────────────────────────────────────────────────
DO $$
DECLARE
    v_idx_count INT;
BEGIN
    SELECT count(*) INTO v_idx_count
      FROM pg_indexes
     WHERE schemaname = 'learning_mgmt'
       AND tablename  = 'training_enrollments'
       AND indexname  = 'uq_training_enrollments_program_employee';
    RAISE NOTICE 'V098 verify: uq_training_enrollments_program_employee present=%', v_idx_count;
END $$;
