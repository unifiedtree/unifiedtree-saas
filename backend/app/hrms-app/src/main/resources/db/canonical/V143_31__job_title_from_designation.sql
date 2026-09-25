-- V143.31: fill hrms.employees.job_title from the designation where it is blank.
--
-- Employees created or edited through the Employee Master (WorkforceEmployee,
-- which does not map job_title) had a designation but no job_title, so the
-- attendance staff lists, the ESS home and letters showed a blank role. The
-- service now keeps them in sync; this backfills existing rows. Only fills
-- blanks, never overwrites a title someone typed. Idempotent.

UPDATE hrms.employees e
   SET job_title = d.title
  FROM hrms.designations d
 WHERE d.id = e.designation_id
   AND (e.job_title IS NULL OR btrim(e.job_title) = '');
