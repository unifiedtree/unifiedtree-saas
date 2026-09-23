-- Preserve cancelled corrections while preventing a second payable copy of an exit.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM fnf_mgmt.fnf_settlements WHERE status <> 'CANCELLED'
        GROUP BY tenant_id,employee_id,last_working_day HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate full-and-final settlements exist for an employee exit; review them before applying V127.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fnf_active_exit
    ON fnf_mgmt.fnf_settlements(tenant_id,employee_id,last_working_day)
    WHERE status <> 'CANCELLED';
