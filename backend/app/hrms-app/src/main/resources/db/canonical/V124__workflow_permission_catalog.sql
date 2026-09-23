-- V090 attempted to grant these codes, but no preceding canonical migration
-- inserted them. Seed the catalog before applying the intended role grants.
INSERT INTO rbac.permissions(code,display_name,module) VALUES
 ('hrms.disbursement.read','View payroll disbursement batches','payroll'),
 ('hrms.disbursement.build','Build payroll disbursement batches','payroll'),
 ('hrms.disbursement.post','Post and record payroll disbursement payments','payroll'),
 ('hrms.bank_profile.read','View payroll bank profiles','payroll'),
 ('hrms.bank_profile.manage','Manage payroll bank profiles','payroll'),
 ('hrms.reimb_batch.read','View reimbursement batches','expense'),
 ('hrms.reimb_batch.build','Build reimbursement batches','expense'),
 ('hrms.reimb_batch.post','Post and record reimbursement payments','expense'),
 ('hrms.appraisal.initiate','Initiate company appraisal assignments','performance'),
 ('hrms.kpi.manage','Manage employee KPIs','performance'),
 ('hrms.advance.foreclose','Foreclose or write off employee advances','advance')
ON CONFLICT(code) DO NOTHING;

INSERT INTO rbac.role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM rbac.roles r CROSS JOIN rbac.permissions p
WHERE p.code IN ('hrms.disbursement.read','hrms.disbursement.build','hrms.disbursement.post',
 'hrms.bank_profile.read','hrms.bank_profile.manage','hrms.reimb_batch.read','hrms.reimb_batch.build',
 'hrms.reimb_batch.post','hrms.appraisal.initiate','hrms.kpi.manage','hrms.advance.foreclose')
AND (r.code IN ('OWNER','SUPER_ADMIN','COMPANY_ADMIN','ADMIN')
 OR (r.code='HR_MANAGER' AND p.code IN ('hrms.reimb_batch.read','hrms.reimb_batch.build','hrms.reimb_batch.post','hrms.appraisal.initiate','hrms.kpi.manage','hrms.advance.foreclose'))
 OR (r.code='FINANCE_LEAD' AND p.module IN ('payroll','expense','advance')))
ON CONFLICT DO NOTHING;
