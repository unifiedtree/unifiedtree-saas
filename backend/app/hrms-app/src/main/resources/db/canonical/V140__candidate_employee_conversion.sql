-- Candidate → employee conversion.
--
-- A HIRED candidate is converted into a real hrms.employees row through the
-- ordinary employee-creation service (seat quota, validation, code generation).
-- The link is recorded on the candidate so the conversion is idempotent (a
-- candidate converts at most once) and the pipeline can show "View employee".
ALTER TABLE hiring_mgmt.candidates
    ADD COLUMN IF NOT EXISTS converted_employee_id UUID REFERENCES hrms.employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

-- One employee can only have been produced by one candidate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_converted_employee
    ON hiring_mgmt.candidates (tenant_id, converted_employee_id)
    WHERE converted_employee_id IS NOT NULL;
