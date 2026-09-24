-- V143.4 — take company-wide document + letter + profile perms off department
-- managers. Found by the 2026-09-24 manager review:
--   * a DEPT_MANAGER could preview any letter template for any employee, so a
--     SALARY_REVISION template with {{employee.ctc}} handed them the CTC of
--     every executive across every department;
--   * hrms.document.read let them read any employee's vault documents
--     (ID_PROOF, contracts) — the endpoint has no team scope;
--   * hrms.employee.profile.read let them read anyone's emergency contacts,
--     addresses, dependents, education and experience.
-- A department manager keeps: reading letters they generated themselves,
-- their own team's expense/leave/WFH decisions, and normal ESS. Everything
-- payroll-shaped goes to HR/finance.
--
-- Numbered 143.4 so it cannot collide with a teammate's V144. Idempotent.

DELETE FROM rbac.role_permissions rp
 USING rbac.roles r
 WHERE rp.role_id = r.id
   AND r.tenant_id IS NULL
   AND r.code = 'DEPT_MANAGER'
   AND rp.permission_code IN (
       'hrms.document.read',
       'hrms.employee.profile.read',
       'hrms.letters.template.read',
       'hrms.letters.template.create',
       'hrms.letters.template.update',
       'hrms.letters.template.delete',
       'hrms.letters.generate',
       'hrms.letters.read',
       'hrms.letters.send',
       'hrms.letters.distribute',
       'hrms.letters.void'
   );
