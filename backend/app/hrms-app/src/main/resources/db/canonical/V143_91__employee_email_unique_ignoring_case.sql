-- V143.91: one work email per employee in a workspace, whatever its case or spaces.
--
-- hrms.employees has had UNIQUE (tenant_id, email) since V006, but it compares
-- exactly, so "Ravi@x.com", "ravi@x.com" and "ravi@x.com " could all be saved in
-- one workspace, as three people. The owner asked on 2026-10-05 for one address
-- per person. The API now checks it on every path that adds or edits an employee,
-- imports them or invites their login (EmployeeContactGuard, 409
-- EMAIL_ALREADY_USED); these indexes are the last line of defence behind it, for a
-- race between the check and the insert.
--
--   1. work email: unique per workspace on lower(btrim(email)). Blank emails are
--      left out (people imported or exited without one).
--   2. personal email: the same, on lower(btrim(personal_email)). (A personal email
--      that is someone else's WORK email is refused by the API; an index can't
--      compare two columns.)
--
-- The old exact constraint uq_employee_tenant_email stays.
-- auth.user_credentials already has UNIQUE (tenant_id, lower(email)).
-- No column changes; no JPA entity is touched.
--
-- Safe to apply only when there are no duplicates. Production had none on
-- 2026-10-05 (0 by lower(trim(email)), 0 shared personal emails). Run these first;
-- both must return no rows, or CREATE UNIQUE INDEX fails and names the key:
--
--   SELECT tenant_id, lower(btrim(email)), count(*) FROM hrms.employees
--    WHERE email IS NOT NULL AND btrim(email) <> '' GROUP BY 1, 2 HAVING count(*) > 1;
--   SELECT tenant_id, lower(btrim(personal_email)), count(*) FROM hrms.employees
--    WHERE personal_email IS NOT NULL AND btrim(personal_email) <> '' GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Plain CREATE INDEX (not CONCURRENTLY), so it runs inside BEGIN/COMMIT; it holds a
-- write lock on hrms.employees only while the index builds (a few hundred rows).
-- Idempotent. Production has Flyway OFF: apply by hand, as a superuser.

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_email_norm
    ON hrms.employees (tenant_id, lower(btrim(email)))
 WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_personal_email_norm
    ON hrms.employees (tenant_id, lower(btrim(personal_email)))
 WHERE personal_email IS NOT NULL AND btrim(personal_email) <> '';
