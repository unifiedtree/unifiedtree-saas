-- ============================================================================
-- V115 — Grant attendance.checkin.self to the workspace ADMIN + MANAGER roles
-- ============================================================================
--
-- Context (2026-09-08 button-level audit, Attendance + Time, HIGH):
--
-- The Attendance page's default "My Attendance" tab calls
-- GET /v1/attendance/monthly-stats and /history, both @PreAuthorize
-- hasAuthority('attendance.checkin.self'). V029 granted that to the HRMS
-- roles (HR_MANAGER / COMPANY_ADMIN / DEPT_MANAGER, plus EMPLOYEE from V017),
-- but the WORKSPACE roles seeded later in V035 — ADMIN (…011) and MANAGER
-- (…012) — got hrms.employee.read + attendance.team.read and never
-- checkin.self. Those roles landed on the tab by default (the route admits
-- HRMS_EMPLOYEE_READ) and got two red "Failed to load" blocks with a Retry
-- that re-issued the same 403 forever. That was the literal "nothing works"
-- screenshot.
--
-- Rule (see memory: deploy-verification-and-rbac-baseline): self-service
-- permissions follow from HAVING an employee record, not from the EMPLOYEE
-- role. An ADMIN or MANAGER who is also on the payroll must be able to see
-- their own attendance. The frontend (Attendance.tsx) was also changed to
-- hide the tab and default to Team Dashboard for any role that still lacks
-- the permission — this migration fixes the seeded roles, that fixes custom
-- ones.
--
-- Idempotent. Reversible with a DELETE of the same two rows.

INSERT INTO rbac.role_permissions (role_id, permission_code)
VALUES
    ('00000000-0000-0000-0000-000000000011', 'attendance.checkin.self'),   -- ADMIN
    ('00000000-0000-0000-0000-000000000012', 'attendance.checkin.self')    -- MANAGER
ON CONFLICT DO NOTHING;
