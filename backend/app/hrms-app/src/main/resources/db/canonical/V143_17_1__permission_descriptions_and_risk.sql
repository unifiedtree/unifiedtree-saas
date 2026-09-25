-- V143.17.1: a plain-English description and a risk level for every
-- permission, plus a warning for the HIGH and CRITICAL ones.
--
-- The Roles & permissions catalogue and the Manage access drawer show these
-- words next to each permission, and the confirmation shown before granting a
-- HIGH or CRITICAL permission quotes the warning. Levels:
--   LOW       your own records, or reading reference data
--   MEDIUM    other people's work records, approvals, team views, settings
--   HIGH      money, everyone's salary, personal data (bank / ID numbers),
--             deletions, and anything that changes what people are paid
--   CRITICAL  who can do what, billing, and the workspace itself. Only the
--             workspace OWNER can grant these to a person.
--
-- A permission added later without a level stays LOW until it is described
-- here or in its own migration. Runs after V143_17 (needs its columns).
-- Idempotent: a plain UPDATE of known codes; unknown codes are ignored.

UPDATE rbac.permissions p
   SET description = v.description,
       risk_level  = v.risk_level,
       warning     = v.warning
  FROM (VALUES
    -- attendance
    ('attendance.checkin.face', 'LOW', 'Punch in and out with a face scan on the mobile app.', NULL),
    ('attendance.checkin.self', 'LOW', 'Punch in and out for yourself and see your own attendance.', NULL),
    ('attendance.face.admin.read', 'MEDIUM', 'See who has enrolled their face, and the details of each face punch (match score, time and device).', NULL),
    ('attendance.face.admin.reset', 'HIGH', 'Reset or re-enrol another person''s face, or unlock them after failed face scans.', 'Lets this person replace someone''s enrolled face, so they could punch in as that person.'),
    ('attendance.face.enroll.self', 'LOW', 'Enrol or update your own face for face punch-in.', NULL),
    ('attendance.face.verify.self', 'LOW', 'Verify your own face when you punch in.', NULL),
    ('attendance.overtime.approve', 'MEDIUM', 'Approve or reject overtime for the people in your team. Only the decision is recorded; overtime is not paid automatically.', NULL),
    ('attendance.regularization.approve', 'MEDIUM', 'Approve or reject attendance corrections (missed or wrong punches) for the people in your team.', NULL),
    ('attendance.team.read', 'MEDIUM', 'Open the My team page: see who in your team is present, late, on leave or working from home, and their attendance history.', NULL),
    ('attendance.workforce.admin', 'HIGH', 'Company-wide attendance admin: see everyone''s attendance and requests, manage shifts, and record or correct attendance for other people.', 'Attendance feeds payroll, so this person can change what other people are paid.'),
    -- audit
    ('audit.read', 'HIGH', 'Read the audit log: who did what in the workspace, when and from where.', 'Shows every change made by everyone, including salary and access changes.'),
    -- advances
    ('hrms.advance.approve', 'MEDIUM', 'Approve or reject salary advance requests.', NULL),
    ('hrms.advance.disburse', 'HIGH', 'Mark approved salary advances as paid out to the employee.', 'Money: records that company money was paid out.'),
    ('hrms.advance.foreclose', 'HIGH', 'Close an advance early or write off what is still owed.', 'Money: a written-off advance is not recovered from the employee.'),
    ('hrms.advance.read', 'MEDIUM', 'See everyone''s salary advances, amounts and repayment schedules.', NULL),
    ('hrms.advance.request.self', 'LOW', 'Ask for a salary advance for yourself and see your own advances.', NULL),
    -- performance
    ('hrms.appraisal.initiate', 'MEDIUM', 'Start appraisal rounds for the company and assign who reviews whom.', NULL),
    ('hrms.kpi.manage', 'MEDIUM', 'Create, edit and remove KPIs for anyone in the company, and record their progress.', NULL),
    ('hrms.kpi.progress', 'LOW', 'Record progress on the KPIs of the people in your own team.', NULL),
    ('hrms.performance.read', 'MEDIUM', 'See performance reviews, review cycles and KPIs. Managers see only their own team.', NULL),
    ('hrms.performance.review.self', 'LOW', 'Write your own self-review and see your own goals.', NULL),
    ('hrms.performance.write', 'MEDIUM', 'Run performance for the whole company: create, assign and close review cycles, and see and update everyone''s reviews and KPIs.', NULL),
    -- payroll bank accounts and salary payments
    ('hrms.bank_profile.manage', 'HIGH', 'Add or change the company bank accounts that salaries are paid from.', 'Money: controls which company account salaries are paid from.'),
    ('hrms.bank_profile.read', 'MEDIUM', 'See the company bank accounts used to pay salaries.', NULL),
    ('hrms.disbursement.build', 'HIGH', 'Prepare salary payment batches (the bank file) from a payroll run.', 'Money: builds the bank file that pays salaries.'),
    ('hrms.disbursement.post', 'HIGH', 'Record salary payment batches as sent to the bank and paid.', 'Money: marks salaries as paid to employees.'),
    ('hrms.disbursement.read', 'HIGH', 'See salary payment batches, including amounts and employees'' bank details.', 'Lets this person see everyone''s net pay and bank account numbers.'),
    -- organisation
    ('hrms.branch.read', 'LOW', 'See the company''s branches and their addresses.', NULL),
    ('hrms.branch.write', 'MEDIUM', 'Add, edit or close branches.', NULL),
    ('hrms.contractor.read', 'LOW', 'See contractor agencies.', NULL),
    ('hrms.contractor.write', 'MEDIUM', 'Add, edit or remove contractor agencies.', NULL),
    ('hrms.department.read', 'LOW', 'See departments.', NULL),
    ('hrms.department.write', 'MEDIUM', 'Create, rename or delete departments and choose each department''s head.', NULL),
    ('hrms.designation.read', 'LOW', 'See job titles (designations).', NULL),
    ('hrms.designation.write', 'MEDIUM', 'Create, edit or archive job titles.', NULL),
    ('hrms.employment-type.write', 'MEDIUM', 'Add or change employment types (full-time, contract, intern and so on).', NULL),
    ('hrms.grade.write', 'MEDIUM', 'Add or change pay grades.', NULL),
    ('hrms.project.read', 'LOW', 'See company projects and their tasks.', NULL),
    ('hrms.project.write', 'MEDIUM', 'Create and manage company projects and their tasks.', NULL),
    ('hrms.shift.write', 'MEDIUM', 'Create and change work shifts, and assign them to people.', NULL),
    ('org.company.read', 'LOW', 'See the companies in this workspace and their branches.', NULL),
    ('org.company.write', 'MEDIUM', 'Add or edit companies and branches.', NULL),
    ('org.geofence.write', 'MEDIUM', 'Set where people may punch in from (branch location and radius).', NULL),
    -- compliance
    ('hrms.compliance.inspector.read', 'MEDIUM', 'See labour-inspector visits and the documents shared with inspectors.', NULL),
    ('hrms.compliance.inspector.write', 'HIGH', 'Create inspector sessions and share company records with a visiting inspector.', 'Shares company records with someone outside the company.'),
    ('hrms.compliance.posh', 'HIGH', 'Open the POSH (sexual harassment) complaints register.', 'Shows confidential harassment complaints and the people involved.'),
    ('hrms.compliance.read', 'MEDIUM', 'See the compliance calendar and statutory filings.', NULL),
    ('hrms.compliance.write', 'MEDIUM', 'Add compliance items and record statutory filings.', NULL),
    -- documents
    ('hrms.document.read', 'HIGH', 'Open any employee''s uploaded documents (ID proofs, certificates, contracts).', 'Shows personal documents such as Aadhaar and PAN copies.'),
    ('hrms.document.read.self', 'LOW', 'See your own documents.', NULL),
    ('hrms.document.type.read', 'LOW', 'See the list of document types (Aadhaar, PAN and so on) and their upload rules.', NULL),
    ('hrms.document.type.write', 'MEDIUM', 'Add or change document types, their allowed formats and which ones are required.', NULL),
    ('hrms.document.verify', 'MEDIUM', 'Verify or reject the documents people have uploaded.', NULL),
    ('hrms.document.write', 'HIGH', 'Upload, replace or delete documents on anyone''s record.', 'Can replace or delete personal documents on anyone''s record.'),
    ('hrms.document.write.self', 'LOW', 'Upload your own documents.', NULL),
    -- employees
    ('hrms.employee.bank.read', 'HIGH', 'See employees'' bank account numbers and IFSC codes.', 'Lets this person see everyone''s bank account details.'),
    ('hrms.employee.bank.write', 'HIGH', 'Add or change employees'' bank accounts.', 'Money: changes the account someone''s salary is paid into.'),
    ('hrms.employee.delete', 'HIGH', 'Permanently delete employee records.', 'Deleting an employee cannot be undone.'),
    ('hrms.employee.identity.read', 'HIGH', 'See employees'' identity numbers (Aadhaar, PAN, passport).', 'Lets this person see everyone''s government ID numbers.'),
    ('hrms.employee.identity.write', 'HIGH', 'Change employees'' identity numbers (Aadhaar, PAN, passport).', 'Changes the ID details used for tax and statutory filings.'),
    ('hrms.employee.import', 'MEDIUM', 'Add many employees at once from a CSV or Excel file.', NULL),
    ('hrms.employee.invite', 'MEDIUM', 'Send the sign-in invitation email to an employee.', NULL),
    ('hrms.employee.profile.read', 'MEDIUM', 'See employees'' personal profile sections: addresses, family, education, past jobs and emergency contacts.', NULL),
    ('hrms.employee.profile.write', 'MEDIUM', 'Edit employees'' personal profile sections.', NULL),
    ('hrms.employee.read', 'MEDIUM', 'See the employee directory and every employee''s record.', NULL),
    ('hrms.employee.team.manage', 'MEDIUM', 'For department managers: look up the people who report to you, add new staff to your own department, and set your team''s punch zone and weekly off days. Limited to your own team.', NULL),
    ('hrms.employee.write', 'HIGH', 'Add employees, edit their records, and confirm, put on notice or exit them.', 'Exiting someone ends their access and takes them out of payroll.'),
    ('hrms.ess.read', 'LOW', 'Use the employee self-service pages (My workspace).', NULL),
    -- expenses and reimbursements
    ('hrms.expense.claim.approve', 'MEDIUM', 'Approve or reject expense claims.', NULL),
    ('hrms.expense.claim.read', 'MEDIUM', 'See the expense claims other people have submitted.', NULL),
    ('hrms.expense.claim.self', 'LOW', 'Submit your own expense claims.', NULL),
    ('hrms.expense.policy.read', 'LOW', 'See expense policies and limits.', NULL),
    ('hrms.expense.policy.write', 'MEDIUM', 'Create or change expense policies and limits.', NULL),
    ('hrms.expense.reimbursement', 'HIGH', 'Mark approved expense claims as reimbursed.', 'Money: records that company money was paid out.'),
    ('hrms.reimb_batch.build', 'MEDIUM', 'Prepare reimbursement payment batches from approved claims.', NULL),
    ('hrms.reimb_batch.post', 'HIGH', 'Record reimbursement batches as paid.', 'Money: records that company money was paid out.'),
    ('hrms.reimb_batch.read', 'MEDIUM', 'See reimbursement payment batches.', NULL),
    -- full & final
    ('hrms.fnf.approve', 'HIGH', 'Approve full & final settlements for people who are leaving.', 'Money: approves the final amount paid to a leaving employee.'),
    ('hrms.fnf.pay', 'HIGH', 'Mark an approved full & final settlement as paid.', 'Money: records that the settlement was paid.'),
    ('hrms.fnf.process', 'MEDIUM', 'Prepare full & final settlements for people who are leaving.', NULL),
    ('hrms.fnf.read', 'MEDIUM', 'See full & final settlements and their amounts.', NULL),
    -- hiring
    ('hrms.hiring.candidate.write', 'MEDIUM', 'Add candidates and move them through the hiring stages.', NULL),
    ('hrms.hiring.offer.read', 'MEDIUM', 'See offer letters, including the salary offered to candidates.', NULL),
    ('hrms.hiring.offer.write', 'MEDIUM', 'Create, send and withdraw offer letters.', NULL),
    ('hrms.hiring.read', 'MEDIUM', 'See job openings and the candidates who applied.', NULL),
    ('hrms.hiring.write', 'MEDIUM', 'Create and manage job openings.', NULL),
    -- integrations
    ('hrms.integration.read', 'MEDIUM', 'See which outside systems are connected to the workspace.', NULL),
    ('hrms.integration.write', 'HIGH', 'Connect or disconnect outside systems and change their keys.', 'Connected systems can read or change workspace data.'),
    -- learning
    ('hrms.learning.enroll.self', 'LOW', 'Enrol in training programs and see your own learning.', NULL),
    ('hrms.learning.read', 'LOW', 'See training programs and the skills list.', NULL),
    ('hrms.learning.skill.read', 'MEDIUM', 'See the skills and certifications of other employees.', NULL),
    ('hrms.learning.write', 'MEDIUM', 'Create and manage training programs, skills and certifications.', NULL),
    -- leave
    ('hrms.leave.approve.l1', 'MEDIUM', 'First-level leave approval: approve or reject leave for the people in your team.', NULL),
    ('hrms.leave.approve.l2', 'MEDIUM', 'HR leave approval: approve or reject anyone''s leave, including after their manager.', NULL),
    ('hrms.leave.read', 'LOW', 'See leave types, holidays and the leave calendar.', NULL),
    ('leave.balance.read', 'LOW', 'See your own leave balance.', NULL),
    ('leave.request.self', 'LOW', 'Apply for leave for yourself.', NULL),
    ('leave.type.write', 'MEDIUM', 'Add or change leave types, their yearly quota and carry-forward rules.', NULL),
    -- letters
    ('hrms.letters.delete', 'HIGH', 'Delete letters that were generated for employees.', 'A deleted letter cannot be recovered.'),
    ('hrms.letters.distribute', 'MEDIUM', 'Send a letter to many employees at once.', NULL),
    ('hrms.letters.generate', 'MEDIUM', 'Create letters (offer, experience, salary revision and so on) for employees.', NULL),
    ('hrms.letters.read', 'MEDIUM', 'See the letters generated for any employee.', NULL),
    ('hrms.letters.read.self', 'LOW', 'See your own letters.', NULL),
    ('hrms.letters.send', 'MEDIUM', 'Email letters to employees.', NULL),
    ('hrms.letters.template.create', 'MEDIUM', 'Create letter templates.', NULL),
    ('hrms.letters.template.delete', 'MEDIUM', 'Delete letter templates.', NULL),
    ('hrms.letters.template.read', 'LOW', 'See letter templates.', NULL),
    ('hrms.letters.template.update', 'MEDIUM', 'Edit letter templates.', NULL),
    ('hrms.letters.void', 'MEDIUM', 'Cancel (void) a generated letter so it is no longer valid.', NULL),
    -- notifications
    ('hrms.notiftemplate.read', 'LOW', 'See the workspace''s notification message templates.', NULL),
    ('hrms.notiftemplate.write', 'MEDIUM', 'Edit notification message templates, and send today''s birthday and work-anniversary messages straight away.', NULL),
    -- onboarding and assets
    ('hrms.onboarding.asset.read', 'LOW', 'See company assets (laptops, ID cards and so on) and who has them.', NULL),
    ('hrms.onboarding.asset.write', 'MEDIUM', 'Add assets, and hand them out or take them back.', NULL),
    ('hrms.onboarding.instance.read', 'LOW', 'See onboarding checklists.', NULL),
    ('hrms.onboarding.instance.write', 'MEDIUM', 'Start onboarding for new joiners and manage their checklists.', NULL),
    ('hrms.onboarding.task.complete', 'LOW', 'Tick off the onboarding tasks assigned to you.', NULL),
    ('hrms.onboarding.template.read', 'LOW', 'See onboarding checklist templates.', NULL),
    ('hrms.onboarding.template.write', 'MEDIUM', 'Create and change onboarding checklist templates.', NULL),
    -- incentives
    ('hrms.pli.read', 'MEDIUM', 'See everyone''s performance-linked incentive awards and amounts.', NULL),
    ('hrms.pli.read.self', 'LOW', 'See your own incentive awards.', NULL),
    ('hrms.pli.target.read', 'LOW', 'See incentive targets.', NULL),
    ('hrms.pli.target.write', 'MEDIUM', 'Set incentive targets.', NULL),
    ('hrms.pli.write', 'HIGH', 'Create and approve incentive awards and mark them as paid.', 'Money: decides the incentive amounts paid to employees.'),
    -- policies and probation
    ('hrms.policy.acknowledge.self', 'LOW', 'Read and acknowledge HR policies.', NULL),
    ('hrms.policy.read', 'LOW', 'See HR policies.', NULL),
    ('hrms.policy.write', 'MEDIUM', 'Create, publish and change HR policies.', NULL),
    ('hrms.probation.config.read', 'LOW', 'See the probation reminder settings.', NULL),
    ('hrms.probation.config.update', 'MEDIUM', 'Change the probation reminder settings.', NULL),
    ('hrms.probation.reminders.read', 'LOW', 'See the probation reminders that were sent.', NULL),
    -- reports
    ('hrms.report.attendance', 'MEDIUM', 'See company-wide attendance and late-mark reports.', NULL),
    ('hrms.report.attrition', 'MEDIUM', 'See the attrition report (who left and why).', NULL),
    ('hrms.report.diversity', 'MEDIUM', 'See the workforce diversity report.', NULL),
    ('hrms.report.headcount', 'MEDIUM', 'See the headcount report.', NULL),
    ('hrms.report.leave', 'MEDIUM', 'See the leave balance report for everyone.', NULL),
    -- payroll
    ('payroll.components.manage', 'HIGH', 'Create or change salary components (Basic, HRA, allowances, deductions).', 'Money: changes how every salary is calculated.'),
    ('payroll.components.read', 'LOW', 'See the salary components.', NULL),
    ('payroll.payslip.read.self', 'LOW', 'See and download your own payslips.', NULL),
    ('payroll.pt_slabs.read', 'LOW', 'See the Professional Tax slabs.', NULL),
    ('payroll.runs.lock', 'HIGH', 'Lock a processed payroll run, or reopen a locked one.', 'Money: a locked run is final; reopening it lets salaries change again.'),
    ('payroll.runs.manage', 'HIGH', 'Create and process payroll runs.', 'Money: calculates what everyone is paid this month.'),
    ('payroll.runs.read', 'HIGH', 'See payroll runs, including every employee''s pay for the month.', 'Lets this person see everyone''s salary.'),
    ('payroll.settings.read', 'MEDIUM', 'See the PF, ESI and Professional Tax settings.', NULL),
    ('payroll.settings.update', 'HIGH', 'Change the PF, ESI and Professional Tax settings.', 'Money: changes the statutory deductions on every payslip.'),
    ('payroll.structure.manage', 'HIGH', 'Set or revise employees'' salaries (CTC and salary structure).', 'Money: changes what people are paid.'),
    ('payroll.structure.read', 'HIGH', 'See every employee''s salary (CTC and salary breakdown).', 'Lets this person see everyone''s salary.'),
    ('payroll.structure.read.self', 'LOW', 'See your own salary structure.', NULL),
    -- platform (never available to workspaces)
    ('platform.admin', 'CRITICAL', 'Platform operator access. Not available inside a workspace.', 'Platform operators only.'),
    ('platform.tenant.approve', 'CRITICAL', 'Approve new workspaces and their modules. Platform operators only.', 'Platform operators only.'),
    ('platform.tenant.read', 'CRITICAL', 'List workspace sign-up requests. Platform operators only.', 'Platform operators only.'),
    ('platform.tenant.reject', 'CRITICAL', 'Reject workspace sign-ups. Platform operators only.', 'Platform operators only.'),
    -- access control
    ('rbac.role.write', 'CRITICAL', 'Create, duplicate, change and delete roles, and give roles to people from the Roles & permissions page.', 'Controls who can do what in the whole workspace. Only the workspace owner can give this to someone.'),
    ('rbac.access.manage-overrides', 'CRITICAL', 'Give one person an extra permission, or take away a permission their role would give them, with a reason and an optional end date. You can only give permissions you hold yourself.', 'Controls who can do what. Only the workspace owner can give this to someone.'),
    -- settings
    ('settings.holidays.write', 'MEDIUM', 'Add or change the holiday calendar.', NULL),
    ('settings.hrconfig.write', 'MEDIUM', 'Change the HR configuration: work week, probation length, employee code format and attendance rules.', NULL),
    ('settings.read', 'LOW', 'See the workspace and HR settings.', NULL),
    ('tenant.settings.write', 'CRITICAL', 'Owner-level workspace changes: change or cancel the paid plan and autopay, and export, reset or delete the workspace.', 'Can cancel the subscription or delete the whole workspace. Only the workspace owner can give this to someone.'),
    -- work from home
    ('wfh.approve', 'MEDIUM', 'Approve or reject work-from-home requests.', NULL),
    ('wfh.request.self', 'LOW', 'Ask to work from home.', NULL),
    -- workspace
    ('workspace.account.read', 'LOW', 'See your own account and the workspaces you belong to.', NULL),
    ('workspace.billing.manage', 'CRITICAL', 'See how many seats are used and manage the workspace''s billing.', 'Money: affects what the company is billed. Only the workspace owner can give this to someone.'),
    ('workspace.context.read', 'LOW', 'Load the workspace. Everyone needs this to use the app.', NULL),
    ('workspace.modules.buy', 'CRITICAL', 'Buy or request new modules for the workspace.', 'Money: adds paid modules to the company''s bill. Only the workspace owner can give this to someone.'),
    ('workspace.modules.read', 'LOW', 'See which modules are active and which can be added.', NULL),
    ('workspace.users.manage', 'CRITICAL', 'Invite people, resend invitations, and give or remove roles in Users & access.', 'Controls who can sign in and what they can reach. Only the workspace owner can give this to someone.'),
    ('workspace.users.read', 'MEDIUM', 'See everyone who can sign in to the workspace and their roles.', NULL)
  ) AS v(code, risk_level, description, warning)
 WHERE p.code = v.code;

-- Clearer names for the few that read like code.
UPDATE rbac.permissions p
   SET display_name = v.display_name
  FROM (VALUES
    ('hrms.leave.read', 'View leave types and calendar'),
    ('hrms.letters.delete', 'Delete letters'),
    ('hrms.letters.distribute', 'Send letters in bulk'),
    ('hrms.letters.generate', 'Generate letters'),
    ('hrms.letters.read', 'View letters'),
    ('hrms.letters.read.self', 'View own letters'),
    ('hrms.letters.send', 'Email letters'),
    ('hrms.letters.template.create', 'Create letter templates'),
    ('hrms.letters.template.delete', 'Delete letter templates'),
    ('hrms.letters.template.read', 'View letter templates'),
    ('hrms.letters.template.update', 'Edit letter templates'),
    ('hrms.letters.void', 'Void letters'),
    ('hrms.branch.read', 'View branches'),
    ('hrms.branch.write', 'Manage branches'),
    ('tenant.settings.write', 'Owner-level workspace changes')
  ) AS v(code, display_name)
 WHERE p.code = v.code;
