-- V119 — back-fill employees.branch_id where the company has exactly one branch.
--
-- Anil Branch.docx (2026-09-10): the Workforce Directory shows a BRANCH column
-- and a "All Branches" filter, and for most employees the column read "—".
--
-- Branch is only ever set two ways: explicitly on the employee's profile, or
-- derived from the Punch Zone the employee is assigned to (a geofence zone
-- carries branch_id). The Add Employee wizard has no Branch field — it mirrors
-- the mobile Add Staff form field for field — and Punch Zone is explicitly
-- optional, so the ordinary onboarding path left branch_id NULL and nothing
-- ever filled it in.
--
-- WorkforceEmployeeService.create now defaults to the company's sole active
-- branch when nothing else resolves one. This does the same for rows that
-- already exist. Where a company has zero or more than one active branch the
-- row is left NULL rather than guessed at — HR picks it on the profile.
--
-- Idempotent: only touches NULL branch_id, so re-running is a no-op.

UPDATE hrms.employees e
   SET branch_id = sb.branch_id
  FROM (
        -- (array_agg(id))[1] rather than MIN(id): Postgres has no min(uuid),
        -- and HAVING COUNT(*) = 1 means there is exactly one element anyway.
        SELECT company_id, (array_agg(id))[1] AS branch_id
          FROM org.branches
         WHERE is_active = TRUE
         GROUP BY company_id
        HAVING COUNT(*) = 1
       ) sb
 WHERE e.company_id = sb.company_id
   AND e.branch_id IS NULL;
