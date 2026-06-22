-- ============================================================================
-- V066 - FINANCE_LEAD separation of duties
-- ----------------------------------------------------------------------------
-- The RBAC audit (and the V059 inline comment) flagged FINANCE_LEAD (...0003)
-- as over-privileged: it accumulated HR-domain powers in V029, which mislabeled
-- ...0003 as "COMPANY_ADMIN". A Finance Lead should NOT approve leave, approve
-- attendance regularizations, bulk-import employees, or manage letter templates.
--
-- This migration enforces separation of duties by REVOKING those grants from
-- FINANCE_LEAD. It KEEPS the finance-appropriate access:
--   - all payroll.*            (settings, components, structure, runs, slabs)
--   - all hrms.report.*        (headcount, attrition, attendance, leave, diversity)
--   - letters READ / GENERATE / SEND / VOID + template.read (operate on letters,
--     not author templates)
--   - own leave + balance, attendance.team.read (visibility for payroll)
--
-- Revoked (HR-domain, not finance):
--   hrms.leave.approve.l1, hrms.leave.approve.l2   (leave approval = HR/manager)
--   attendance.regularization.approve              (attendance approval = HR/manager)
--   hrms.employee.import                           (bulk onboarding = HR)
--   hrms.letters.template.create/update/delete     (template authoring = HR)
--
-- Idempotent: DELETE is naturally idempotent.
-- ============================================================================

DELETE FROM rbac.role_permissions
 WHERE role_id = '00000000-0000-0000-0000-000000000003'
   AND permission_code IN (
       'hrms.leave.approve.l1',
       'hrms.leave.approve.l2',
       'attendance.regularization.approve',
       'hrms.employee.import',
       'hrms.letters.template.create',
       'hrms.letters.template.update',
       'hrms.letters.template.delete'
   );

DO $$
DECLARE remaining INT;
BEGIN
    SELECT count(*) INTO remaining FROM rbac.role_permissions
     WHERE role_id = '00000000-0000-0000-0000-000000000003'
       AND permission_code IN (
           'hrms.leave.approve.l1', 'hrms.leave.approve.l2',
           'attendance.regularization.approve', 'hrms.employee.import',
           'hrms.letters.template.create', 'hrms.letters.template.update',
           'hrms.letters.template.delete'
       );
    RAISE NOTICE 'FINANCE_LEAD residual HR-domain grants: % (expect 0)', remaining;
END $$;
