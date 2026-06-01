-- ============================================================================
-- V029 - Attendance + Leave permission grants to system roles
-- ----------------------------------------------------------------------------
-- V004 defined the permission catalog.
-- V017 granted EVERYTHING to SUPER_ADMIN and a minimal self-service set to
-- EMPLOYEE (attendance.checkin.self, leave.balance.read, leave.request.self).
-- HR_MANAGER (000..002), DEPT_MANAGER (000..005), and COMPANY_ADMIN (000..003)
-- have no explicit attendance or leave grants → attendance/leave endpoints
-- return 403 for those roles.
--
-- This migration grants the right attendance + leave permissions to each role.
-- ON CONFLICT DO NOTHING makes it safe to re-run.
-- ============================================================================

-- ── Attendance: self-service (checkin, checkout, history, corrections/my) ───
-- Already granted to EMPLOYEE. Extend to manager roles so managers who work
-- alongside employees can also punch in/out.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'attendance.checkin.self'),   -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'attendance.checkin.self'),   -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000005', 'attendance.checkin.self')    -- DEPT_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Attendance: team read (dashboard, logs, dept/{id}/today) ─────────────────
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'attendance.team.read'),      -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'attendance.team.read'),      -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000005', 'attendance.team.read')       -- DEPT_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Attendance: regularization approve (corrections/approvals, manual-entry) ─
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'attendance.regularization.approve'),  -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'attendance.regularization.approve'),  -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000005', 'attendance.regularization.approve')   -- DEPT_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Leave: self-service (apply, cancel) ─────────────────────────────────────
-- Already granted to EMPLOYEE. Extend to manager roles.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'leave.request.self'),        -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'leave.request.self'),        -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000005', 'leave.request.self')         -- DEPT_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Leave: balance read (overview, my balances) ──────────────────────────────
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'leave.balance.read'),        -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'leave.balance.read'),        -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000005', 'leave.balance.read')         -- DEPT_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Leave: L1 approval (dept manager, HR, company admin) ────────────────────
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'hrms.leave.approve.l1'),     -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'hrms.leave.approve.l1'),     -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000005', 'hrms.leave.approve.l1')      -- DEPT_MANAGER
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Leave: L2 approval (HR and company admin only) ───────────────────────────
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'hrms.leave.approve.l2'),     -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'hrms.leave.approve.l2')      -- COMPANY_ADMIN
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Ensure hrms.leave.read / hrms.leave.write exist in permission catalog ────
-- These codes were omitted from V004. Insert here so FK is satisfied.
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.leave.read',  'Leave Read',  'leave'),
    ('hrms.leave.write', 'Leave Write', 'leave')
ON CONFLICT (code) DO NOTHING;

-- ── Leave: read + write (HR and admin manage leave config) ──────────────────
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'hrms.leave.read'),           -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'hrms.leave.read'),           -- COMPANY_ADMIN
    ('00000000-0000-0000-0000-000000000005', 'hrms.leave.read'),           -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000004', 'hrms.leave.read'),           -- EMPLOYEE (own leaves)
    ('00000000-0000-0000-0000-000000000002', 'hrms.leave.write'),          -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000003', 'hrms.leave.write')           -- COMPANY_ADMIN
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt
      FROM rbac.role_permissions
     WHERE permission_code IN ('attendance.checkin.self','attendance.team.read','attendance.regularization.approve')
       AND role_id IN (
           '00000000-0000-0000-0000-000000000002',
           '00000000-0000-0000-0000-000000000003',
           '00000000-0000-0000-0000-000000000005'
       );
    RAISE NOTICE 'Attendance permission grants to manager roles: % (expect 9)', cnt;
END $$;
