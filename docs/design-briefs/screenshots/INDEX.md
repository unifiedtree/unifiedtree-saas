# Screenshots for the Claude Design brief pack

Captured 2026-09-24 02:21 UTC from the local recovery runtime by `apps/platform/e2e/recovery/capture-design-screens.mjs` — 98 images. Routes come from `App.tsx`; every tab and every "open a form" button on each page is captured; writes were blocked during capture.

Views: **owner** = company owner (every route) · **employee** = self-service view · **public** = signed out.

Flags: `EMPTY-STATE` (page shows no records — local demo data is thin), `ERROR-STATE`, `NO-ACCESS`, `REDIRECTED→…` (route guard or module gate sent the user elsewhere), `PAGE-ERRORS` (JavaScript error on the page).

Summary: OK 72 · REDIRECTED 20 · EMPTY-STATE 7

Not captured:
- /hrms/soon/:key — generic coming-soon placeholder

| URL | View | Tab / form | File | Brief | Flags |
|---|---|---|---|---|---|
| `/dashboard` | owner | page | [owner/dashboard.png](owner/dashboard.png) | 01-dashboards.md › Company Admin Dashboard |  |
| `/dashboard` | owner | open Add employee | [owner/dashboard__open-Add-employee.png](owner/dashboard__open-Add-employee.png) | 01-dashboards.md › Company Admin Dashboard | REDIRECTED→/hrms/employees EMPTY-STATE |
| `/dashboard` | owner | open Create | [owner/dashboard__open-Create.png](owner/dashboard__open-Create.png) | 01-dashboards.md › Company Admin Dashboard |  |
| `/dashboard` | owner | open Add notice | [owner/dashboard__open-Add-notice.png](owner/dashboard__open-Add-notice.png) | 01-dashboards.md › Company Admin Dashboard |  |
| `/audit-logs` | owner | page | [owner/audit-logs.png](owner/audit-logs.png) | 10-platform-shell-admin-auth.md › Audit Logs |  |
| `/me` | owner | page | [owner/me.png](owner/me.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) |  |
| `/me` | owner | open Apply leave | [owner/me__open-Apply-leave.png](owner/me__open-Apply-leave.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) | REDIRECTED→/hrms/leave |
| `/me` | owner | open Request WFH | [owner/me__open-Request-WFH.png](owner/me__open-Request-WFH.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) | REDIRECTED→/me/wfh |
| `/me` | owner | open Request Shift Change | [owner/me__open-Request-Shift-Change.png](owner/me__open-Request-Shift-Change.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) | REDIRECTED→/me/shift-change |
| `/me` | owner | open Add time entry | [owner/me__open-Add-time-entry.png](owner/me__open-Add-time-entry.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) |  |
| `/me/wfh` | owner | page | [owner/me-wfh.png](owner/me-wfh.png) | 02-self-service-and-team.md › Apply for Work From Home |  |
| `/hrms/employees` | owner | page | [owner/hrms-employees.png](owner/hrms-employees.png) | 03-company-and-master.md › Workforce Directory |  |
| `/hrms/employees` | owner | open Import | [owner/hrms-employees__open-Import.png](owner/hrms-employees__open-Import.png) | 03-company-and-master.md › Workforce Directory | REDIRECTED→/hrms/employees/import |
| `/hrms/employees` | owner | open Add Employee | [owner/hrms-employees__open-Add-Employee.png](owner/hrms-employees__open-Add-Employee.png) | 03-company-and-master.md › Workforce Directory | EMPTY-STATE |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | page | [owner/hrms-employees-22222222-2222-2222-2222-222222222222.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | tab Personal | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Personal.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Personal.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | tab Job | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Job.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Job.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | tab Attendance | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Attendance.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Attendance.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | tab Payroll | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Payroll.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Payroll.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | tab Documents | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Documents.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Documents.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | tab Letters | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Letters.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Letters.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | tab Performance | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Performance.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Performance.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | tab Exit | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Exit.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__tab-Exit.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/employees/22222222-2222-2222-2222-222222222222` | owner | open Start Notice | [owner/hrms-employees-22222222-2222-2222-2222-222222222222__open-Start-Notice.png](owner/hrms-employees-22222222-2222-2222-2222-222222222222__open-Start-Notice.png) | 03-company-and-master.md › Employee workspace |  |
| `/hrms/attendance` | owner | page | [owner/hrms-attendance.png](owner/hrms-attendance.png) | 04-attendance-and-time.md › Daily Tracking (Attendance) |  |
| `/hrms/attendance` | owner | tab Daily Logs | [owner/hrms-attendance__tab-Daily-Logs.png](owner/hrms-attendance__tab-Daily-Logs.png) | 04-attendance-and-time.md › Daily Tracking (Attendance) |  |
| `/hrms/attendance` | owner | tab Face Punch Logs | [owner/hrms-attendance__tab-Face-Punch-Logs.png](owner/hrms-attendance__tab-Face-Punch-Logs.png) | 04-attendance-and-time.md › Daily Tracking (Attendance) | EMPTY-STATE |
| `/hrms/attendance` | owner | tab Regularization | [owner/hrms-attendance__tab-Regularization.png](owner/hrms-attendance__tab-Regularization.png) | 04-attendance-and-time.md › Daily Tracking (Attendance) |  |
| `/hrms/expenses` | owner | page | [owner/hrms-expenses.png](owner/hrms-expenses.png) | 05-leave-expense-advances.md › Expense Center |  |
| `/hrms/expenses` | owner | tab Submit Claim | [owner/hrms-expenses__tab-Submit-Claim.png](owner/hrms-expenses__tab-Submit-Claim.png) | 05-leave-expense-advances.md › Expense Center |  |
| `/hrms/expenses` | owner | tab Approvals | [owner/hrms-expenses__tab-Approvals.png](owner/hrms-expenses__tab-Approvals.png) | 05-leave-expense-advances.md › Expense Center |  |
| `/hrms/expenses` | owner | tab Reimbursement batches | [owner/hrms-expenses__tab-Reimbursement-batches.png](owner/hrms-expenses__tab-Reimbursement-batches.png) | 05-leave-expense-advances.md › Expense Center |  |
| `/hrms/expenses` | owner | tab Policies | [owner/hrms-expenses__tab-Policies.png](owner/hrms-expenses__tab-Policies.png) | 05-leave-expense-advances.md › Expense Center |  |
| `/hrms/performance` | owner | page | [owner/hrms-performance.png](owner/hrms-performance.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | owner | tab Appraisals & 360 Feedback | [owner/hrms-performance__tab-Appraisals-360-Feedback.png](owner/hrms-performance__tab-Appraisals-360-Feedback.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | owner | tab KPI Tracking | [owner/hrms-performance__tab-KPI-Tracking.png](owner/hrms-performance__tab-KPI-Tracking.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | owner | tab Review cycles | [owner/hrms-performance__tab-Review-cycles.png](owner/hrms-performance__tab-Review-cycles.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | owner | tab Goals & KPIs | [owner/hrms-performance__tab-Goals-KPIs.png](owner/hrms-performance__tab-Goals-KPIs.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | owner | tab Employee reviews | [owner/hrms-performance__tab-Employee-reviews.png](owner/hrms-performance__tab-Employee-reviews.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | owner | tab My Goals | [owner/hrms-performance__tab-My-Goals.png](owner/hrms-performance__tab-My-Goals.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | owner | tab My Reviews | [owner/hrms-performance__tab-My-Reviews.png](owner/hrms-performance__tab-My-Reviews.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | owner | open Create cycle | [owner/hrms-performance__open-Create-cycle.png](owner/hrms-performance__open-Create-cycle.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/learning` | owner | page | [owner/hrms-learning.png](owner/hrms-learning.png) | 08-performance-learning-compliance-exit.md › Learning Center |  |
| `/hrms/learning` | owner | tab My Training | [owner/hrms-learning__tab-My-Training.png](owner/hrms-learning__tab-My-Training.png) | 08-performance-learning-compliance-exit.md › Learning Center |  |
| `/hrms/learning` | owner | tab Skill Matrix | [owner/hrms-learning__tab-Skill-Matrix.png](owner/hrms-learning__tab-Skill-Matrix.png) | 08-performance-learning-compliance-exit.md › Learning Center | EMPTY-STATE |
| `/hrms/learning` | owner | tab Certifications | [owner/hrms-learning__tab-Certifications.png](owner/hrms-learning__tab-Certifications.png) | 08-performance-learning-compliance-exit.md › Learning Center | EMPTY-STATE |
| `/hrms/learning` | owner | open New Program | [owner/hrms-learning__open-New-Program.png](owner/hrms-learning__open-New-Program.png) | 08-performance-learning-compliance-exit.md › Learning Center |  |
| `/hrms/pli` | owner | page | [owner/hrms-pli.png](owner/hrms-pli.png) | 06-payroll.md › Production-Linked Incentive (Incentive Center) |  |
| `/hrms/pli` | owner | tab All Awards | [owner/hrms-pli__tab-All-Awards.png](owner/hrms-pli__tab-All-Awards.png) | 06-payroll.md › Production-Linked Incentive (Incentive Center) |  |
| `/hrms/pli` | owner | tab My Incentives | [owner/hrms-pli__tab-My-Incentives.png](owner/hrms-pli__tab-My-Incentives.png) | 06-payroll.md › Production-Linked Incentive (Incentive Center) | EMPTY-STATE |
| `/hrms/integrations` | owner | page | [owner/hrms-integrations.png](owner/hrms-integrations.png) | 03-company-and-master.md › Integrations Directory |  |
| `/hrms/integrations` | owner | open Add Integration | [owner/hrms-integrations__open-Add-Integration.png](owner/hrms-integrations__open-Add-Integration.png) | 03-company-and-master.md › Integrations Directory |  |
| `/hrms/notification-templates` | owner | page | [owner/hrms-notification-templates.png](owner/hrms-notification-templates.png) | 03-company-and-master.md › Notification Templates |  |
| `/hrms/notification-templates` | owner | open Add Template | [owner/hrms-notification-templates__open-Add-Template.png](owner/hrms-notification-templates__open-Add-Template.png) | 03-company-and-master.md › Notification Templates |  |
| `/hrms/shifts` | owner | page | [owner/hrms-shifts.png](owner/hrms-shifts.png) | 04-attendance-and-time.md › Shifts & Overtime |  |
| `/hrms/shifts` | owner | tab Roster | [owner/hrms-shifts__tab-Roster.png](owner/hrms-shifts__tab-Roster.png) | 04-attendance-and-time.md › Shifts & Overtime |  |
| `/hrms/shifts` | owner | tab Overtime | [owner/hrms-shifts__tab-Overtime.png](owner/hrms-shifts__tab-Overtime.png) | 04-attendance-and-time.md › Shifts & Overtime |  |
| `/hrms/shifts` | owner | tab Shift requests 1 | [owner/hrms-shifts__tab-Shift-requests-1.png](owner/hrms-shifts__tab-Shift-requests-1.png) | 04-attendance-and-time.md › Shifts & Overtime |  |
| `/hrms/shifts` | owner | open Add Shift | [owner/hrms-shifts__open-Add-Shift.png](owner/hrms-shifts__open-Add-Shift.png) | 04-attendance-and-time.md › Shifts & Overtime |  |
| `/hrms/ess` | owner | page | [owner/hrms-ess.png](owner/hrms-ess.png) | — |  |
| `/hrms/ess` | owner | open Apply leave | [owner/hrms-ess__open-Apply-leave.png](owner/hrms-ess__open-Apply-leave.png) | — | REDIRECTED→/hrms/leave |
| `/hrms/ess` | owner | open Request WFH | [owner/hrms-ess__open-Request-WFH.png](owner/hrms-ess__open-Request-WFH.png) | — | REDIRECTED→/me/wfh |
| `/hrms/ess` | owner | open Request Shift Change | [owner/hrms-ess__open-Request-Shift-Change.png](owner/hrms-ess__open-Request-Shift-Change.png) | — | REDIRECTED→/me/shift-change |
| `/hrms/ess` | owner | open Add time entry | [owner/hrms-ess__open-Add-time-entry.png](owner/hrms-ess__open-Add-time-entry.png) | — |  |
| `/me/salary` | owner | page | [owner/me-salary.png](owner/me-salary.png) | 02-self-service-and-team.md › My Salary |  |
| `/me/payslips` | owner | page | [owner/me-payslips.png](owner/me-payslips.png) | 02-self-service-and-team.md › My Payslips | EMPTY-STATE |
| `/hrms/letters/distributions` | owner | page | [owner/hrms-letters-distributions.png](owner/hrms-letters-distributions.png) | 07-recruitment-onboarding-letters.md › Letter Distributions |  |
| `/hrms/letters/distributions` | owner | open New Distribution | [owner/hrms-letters-distributions__open-New-Distribution.png](owner/hrms-letters-distributions__open-New-Distribution.png) | 07-recruitment-onboarding-letters.md › Letter Distributions |  |
| `/dashboard` | employee | page | [employee/dashboard.png](employee/dashboard.png) | 01-dashboards.md › Company Admin Dashboard |  |
| `/dashboard` | employee | open Add Time-Off | [employee/dashboard__open-Add-Time-Off.png](employee/dashboard__open-Add-Time-Off.png) | 01-dashboards.md › Company Admin Dashboard | REDIRECTED→/hrms/leave |
| `/me` | employee | page | [employee/me.png](employee/me.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) |  |
| `/me` | employee | open Apply leave | [employee/me__open-Apply-leave.png](employee/me__open-Apply-leave.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) | REDIRECTED→/hrms/leave |
| `/me` | employee | open Request WFH | [employee/me__open-Request-WFH.png](employee/me__open-Request-WFH.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) | REDIRECTED→/me/wfh |
| `/me` | employee | open Request Shift Change | [employee/me__open-Request-Shift-Change.png](employee/me__open-Request-Shift-Change.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) | REDIRECTED→/me/shift-change |
| `/me` | employee | open Add time entry | [employee/me__open-Add-time-entry.png](employee/me__open-Add-time-entry.png) | 02-self-service-and-team.md › My Workspace (ESS Dashboard) |  |
| `/me/wfh` | employee | page | [employee/me-wfh.png](employee/me-wfh.png) | 02-self-service-and-team.md › Apply for Work From Home |  |
| `/me/payslips` | employee | page | [employee/me-payslips.png](employee/me-payslips.png) | 02-self-service-and-team.md › My Payslips |  |
| `/me/salary` | employee | page | [employee/me-salary.png](employee/me-salary.png) | 02-self-service-and-team.md › My Salary |  |
| `/hrms/ess` | employee | page | [employee/hrms-ess.png](employee/hrms-ess.png) | — |  |
| `/hrms/ess` | employee | open Apply leave | [employee/hrms-ess__open-Apply-leave.png](employee/hrms-ess__open-Apply-leave.png) | — | REDIRECTED→/hrms/leave |
| `/hrms/ess` | employee | open Request WFH | [employee/hrms-ess__open-Request-WFH.png](employee/hrms-ess__open-Request-WFH.png) | — | REDIRECTED→/me/wfh |
| `/hrms/ess` | employee | open Request Shift Change | [employee/hrms-ess__open-Request-Shift-Change.png](employee/hrms-ess__open-Request-Shift-Change.png) | — | REDIRECTED→/me/shift-change |
| `/hrms/ess` | employee | open Add time entry | [employee/hrms-ess__open-Add-time-entry.png](employee/hrms-ess__open-Add-time-entry.png) | — |  |
| `/hrms/attendance` | employee | page | [employee/hrms-attendance.png](employee/hrms-attendance.png) | 04-attendance-and-time.md › Daily Tracking (Attendance) |  |
| `/hrms/attendance` | employee | tab Face Punch Logs | [employee/hrms-attendance__tab-Face-Punch-Logs.png](employee/hrms-attendance__tab-Face-Punch-Logs.png) | 04-attendance-and-time.md › Daily Tracking (Attendance) |  |
| `/hrms/attendance` | employee | tab Regularization | [employee/hrms-attendance__tab-Regularization.png](employee/hrms-attendance__tab-Regularization.png) | 04-attendance-and-time.md › Daily Tracking (Attendance) |  |
| `/hrms/expenses` | employee | page | [employee/hrms-expenses.png](employee/hrms-expenses.png) | 05-leave-expense-advances.md › Expense Center |  |
| `/hrms/expenses` | employee | tab Submit Claim | [employee/hrms-expenses__tab-Submit-Claim.png](employee/hrms-expenses__tab-Submit-Claim.png) | 05-leave-expense-advances.md › Expense Center |  |
| `/hrms/performance` | employee | page | [employee/hrms-performance.png](employee/hrms-performance.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | employee | tab My Reviews | [employee/hrms-performance__tab-My-Reviews.png](employee/hrms-performance__tab-My-Reviews.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/performance` | employee | open Add Goal | [employee/hrms-performance__open-Add-Goal.png](employee/hrms-performance__open-Add-Goal.png) | 08-performance-learning-compliance-exit.md › Performance Center |  |
| `/hrms/learning` | employee | page | [employee/hrms-learning.png](employee/hrms-learning.png) | 08-performance-learning-compliance-exit.md › Learning Center |  |
| `/hrms/learning` | employee | tab My Training | [employee/hrms-learning__tab-My-Training.png](employee/hrms-learning__tab-My-Training.png) | 08-performance-learning-compliance-exit.md › Learning Center |  |
| `/hrms/employees` | employee | page | [employee/hrms-employees.png](employee/hrms-employees.png) | 03-company-and-master.md › Workforce Directory | REDIRECTED→/me |
| `/hrms/employees` | employee | open Apply leave | [employee/hrms-employees__open-Apply-leave.png](employee/hrms-employees__open-Apply-leave.png) | 03-company-and-master.md › Workforce Directory | REDIRECTED→/hrms/leave |
| `/hrms/employees` | employee | open Request WFH | [employee/hrms-employees__open-Request-WFH.png](employee/hrms-employees__open-Request-WFH.png) | 03-company-and-master.md › Workforce Directory | REDIRECTED→/me/wfh |
| `/hrms/employees` | employee | open Request Shift Change | [employee/hrms-employees__open-Request-Shift-Change.png](employee/hrms-employees__open-Request-Shift-Change.png) | 03-company-and-master.md › Workforce Directory | REDIRECTED→/me/shift-change |
| `/hrms/employees` | employee | open Add time entry | [employee/hrms-employees__open-Add-time-entry.png](employee/hrms-employees__open-Add-time-entry.png) | 03-company-and-master.md › Workforce Directory | REDIRECTED→/me |
