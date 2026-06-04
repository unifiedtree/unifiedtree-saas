-- V051: Remove tenant-wide employee directory read from the base EMPLOYEE role.
--
-- SECURITY FIX (cross-employee data scoping). The EMPLOYEE role (id …0004) was
-- seeded in V017 with `hrms.employee.read`. The WorkforceController employee
-- endpoints authorize with:
--     hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER')
--       or hasAuthority('hrms.employee.read')
--   • GET /v1/hrms/employees        (list every employee in the tenant)
--   • GET /v1/hrms/employees/{id}   (read any employee — NO self-scoping, unlike
--                                    the legacy /v1/employees/{id})
-- so any base employee could enumerate the whole company and open any coworker's
-- record. The WorkforceEmployee payload carries compensation (ctcAnnual),
-- date-of-birth and phone, making this a latent cross-employee PII/comp leak
-- (harmless in the demo only because those columns are currently null).
--
-- A base employee must reach their OWN data through the self-service endpoints
-- (/v1/employees/me, /v1/leave/my, /v1/payroll/payslips/me, /v1/letters/my),
-- none of which depend on hrms.employee.read.
--
-- FINANCE_LEAD and DEPT_MANAGER intentionally KEEP hrms.employee.read (V037 —
-- "directory read-only view"); HR_MANAGER/SUPER_ADMIN/etc. are unaffected. Only
-- the EMPLOYEE grant is removed here.
DELETE FROM rbac.role_permissions
 WHERE role_id = '00000000-0000-0000-0000-000000000004'  -- EMPLOYEE
   AND permission_code = 'hrms.employee.read';

DO $$
DECLARE emp_read INT;
BEGIN
    SELECT count(*) INTO emp_read
      FROM rbac.role_permissions
     WHERE role_id = '00000000-0000-0000-0000-000000000004'
       AND permission_code = 'hrms.employee.read';
    RAISE NOTICE 'EMPLOYEE hrms.employee.read after V051: % (expect 0)', emp_read;
END $$;
