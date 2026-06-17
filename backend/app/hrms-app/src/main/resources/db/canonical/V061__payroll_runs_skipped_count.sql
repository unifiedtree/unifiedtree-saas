-- FIX P1-4: surface how many otherwise-eligible employees were skipped during a
-- payroll run because they have no current salary structure assigned. Persisted
-- on the run so the count survives reloads and is shown as a banner on the run
-- detail page (the identities are queried live via /runs/{id}/skipped).
ALTER TABLE payroll.runs
    ADD COLUMN IF NOT EXISTS skipped_employee_count INTEGER NOT NULL DEFAULT 0;
