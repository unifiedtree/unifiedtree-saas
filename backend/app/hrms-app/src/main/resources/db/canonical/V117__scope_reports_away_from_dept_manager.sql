-- V117 (2026-09-09) — company-wide reports are not a department manager's to read.
--
-- Found by a four-role probe against production, not by reading code:
-- DEPT_MANAGER holds hrms.report.attendance / headcount / leave, and
-- ReportService filters on company_id ONLY — there is no manager or department
-- predicate anywhere in attendanceSummaryReport, lateMarksReport,
-- headcountReport or leaveBalanceReport. So a department manager could export
-- every employee's name, code, present/late days, overtime, leave balance and
-- headcount for the WHOLE company.
--
-- The same role is deliberately denied the employee directory (V112, the
-- client's rule: "dept manager cannot see ... admin can modify the access").
-- Denying the directory while handing over a CSV of the same people is the
-- directory leak with extra steps.
--
-- The standing instruction for this workspace is to DROP the capability and
-- let the admin grant it back — "we should not just hide we need drop them i
-- mean when admin gives access only then he can see" — so that is what this
-- does. Nothing is hidden in the UI; the permission is gone, every guard that
-- reads it (route, button, backend @perm.check) closes together, and the
-- admin can restore any of the three per role from Settings -> Roles &
-- Permissions if they decide a manager should have them.
--
-- What a department manager KEEPS, because those surfaces are genuinely
-- team-scoped rather than company-wide:
--   * Muster Roll and the team dashboard  -> attendance.team.read
--   * Their own approvals queues          -> leave / advance / expense approve
--   * Their team's attendance analytics   -> attendance.team.read
-- Only the company-wide report exports are withdrawn.
--
-- Reversible: re-running the INSERT half of V026/V038 restores these rows, and
-- so does a click in the admin UI.

DELETE FROM rbac.role_permissions
 WHERE permission_code IN (
           'hrms.report.attendance',
           'hrms.report.headcount',
           'hrms.report.leave'
       )
   AND role_id IN (SELECT id FROM rbac.roles WHERE code IN ('DEPT_MANAGER', 'MANAGER'));
