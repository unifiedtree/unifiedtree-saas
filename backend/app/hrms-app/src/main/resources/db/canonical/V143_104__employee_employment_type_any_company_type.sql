-- V143.104: a person's employment type can be any of their company's employment types, not only the five
-- defaults (owner decision 6 Oct 2026).
--
-- V014 put ck_employees_employment_type on hrms.employees: employment_type IN ('FULL_TIME','PART_TIME',
-- 'CONTRACT','INTERN','CONSULTANT'), so a company's own type (say APPRENTICE) could not be saved on anyone.
-- This drops that check — and any other check on hrms.employees that pins employment_type to that fixed list
-- under another name. The column stays VARCHAR(30) NOT NULL. The backend now checks the
-- code instead: one of the five defaults, or an active employment type of the person's own company
-- (EmploymentTypeCodes.resolveForEmployee). Existing rows are not touched.
--
-- Until this file is applied, giving someone a company's own type answers EMPLOYMENT_TYPE_NOT_READY (422)
-- and the five defaults keep working as today.
--
-- Numbered 143.104 (reserved). Idempotent. Production has Flyway OFF: apply by hand, as the table owner.

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'hrms.employees'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%employment_type%'
           AND pg_get_constraintdef(oid) ILIKE '%FULL_TIME%'
    LOOP
        EXECUTE format('ALTER TABLE hrms.employees DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
