-- Every current bank batch includes the full payroll run. Different bank
-- profiles must not create separate active copies of those same salaries.
-- CANCELLED is the sole non-active status in the disbursement lifecycle;
-- paid batches continue to reserve the run permanently.
-- Do not guess which historical duplicate is legitimate or rewrite payment
-- history. Stop for explicit reconciliation if an existing database has any.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM payroll.disbursement_batches
        WHERE status <> 'CANCELLED'
        GROUP BY tenant_id, run_id HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Multiple active disbursement batches cover a payroll run. Reconcile duplicate batches before applying V126; payment history was not changed.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_disbursement_active_run
    ON payroll.disbursement_batches(tenant_id, run_id)
    WHERE status <> 'CANCELLED';
