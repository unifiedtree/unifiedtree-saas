-- V101__fnf_perm_split.sql (audit 2026-08-15 B3)
--
-- Split hrms.fnf.approve into two permissions so the "approve" and "pay"
-- (disburse) steps enforce segregation of duties per the audit finding.
-- The FnfController.pay endpoint now requires hrms.fnf.pay explicitly.
--
-- Migration must remain idempotent — Flyway is disabled on prod (see
-- flyway-must-stay-disabled memory) and this file is applied by hand via
-- psycopg. Every INSERT is guarded with ON CONFLICT / NOT EXISTS.
--
-- NOTE: This project's rbac.permissions uses `code` as the primary key
-- (not `id`); rbac.role_permissions joins on (role_id, permission_code).

-- 1. Register the new permission if not already present.
INSERT INTO rbac.permissions (code, display_name, module, description)
VALUES ('hrms.fnf.pay',
        'Pay F&F settlement',
        'hrms',
        'Mark an approved Full & Final settlement as PAID (finance disbursement).')
ON CONFLICT (code) DO NOTHING;

-- 2. Grant the new permission to every role that currently holds hrms.fnf.approve
-- so no operator loses the ability to pay overnight; the split takes effect
-- for NEW role assignments only.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT rp.role_id, 'hrms.fnf.pay'
  FROM rbac.role_permissions rp
 WHERE rp.permission_code = 'hrms.fnf.approve'
   AND NOT EXISTS (
       SELECT 1 FROM rbac.role_permissions rp2
        WHERE rp2.role_id = rp.role_id
          AND rp2.permission_code = 'hrms.fnf.pay'
   );

-- No DROP / REVOKE of the old permission — the frontend still calls approve
-- against it, and any misconfigured role that would suddenly lose pay access
-- is grand-fathered by step 2 above. A future migration can retire the alias
-- once every role has been explicitly split.
