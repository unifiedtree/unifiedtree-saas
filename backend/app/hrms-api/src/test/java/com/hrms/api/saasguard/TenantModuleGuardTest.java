package com.hrms.api.saasguard;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Every path prefix the redesign adds needs the HRMS module (a prefix left
 * out would skip the plan check), and existing paths keep their module.
 */
class TenantModuleGuardTest {

    @Test void theRedesignsNewPrefixesNeedHrms() {
        for (String path : new String[]{
                "/v1/team/summary", "/v1/team/approvals", "/v1/team/time-off", "/v1/team/probation",
                "/v1/team/probation/1b52baac-0d42-4dc8-a7d2-4d38cc07b723/confirm", "/v1/team/messages/mine",
                "/v1/team/schedule", "/v1/approvals/recent-decisions", "/v1/ess/timesheets", "/v1/ess/my-requests",
                "/v1/timesheets/approvals", "/v1/me/dashboard/quick-actions", "/v1/me/approvers"}) {
            assertEquals("hrms", TenantModuleGuard.moduleForPath(path), path);
        }
    }

    @Test void undoAndRemindersStayWithTheirKindsModule() {
        assertEquals("leave", TenantModuleGuard.moduleForPath("/v1/leave/1/decision/undo"));
        assertEquals("attendance", TenantModuleGuard.moduleForPath("/v1/wfh/1/decision/undo"));
        assertEquals("attendance", TenantModuleGuard.moduleForPath("/v1/attendance/corrections/1/decision/undo"));
        assertEquals("attendance", TenantModuleGuard.moduleForPath("/v1/shifts/change-requests/1/decision/undo"));
        assertEquals("hrms", TenantModuleGuard.moduleForPath("/v1/expense/claims/1/decision/undo"));
        assertEquals("attendance", TenantModuleGuard.moduleForPath("/v1/attendance/reminders"));
    }

    @Test void thePersonsOwnAccountPathsAndLookalikesStayOpen() {
        assertNull(TenantModuleGuard.moduleForPath("/v1/me/security"));
        assertNull(TenantModuleGuard.moduleForPath("/v1/me/notification-preferences"));
        assertNull(TenantModuleGuard.moduleForPath("/v1/me/assets"));
        assertNull(TenantModuleGuard.moduleForPath("/v1/teams"));
        assertNull(TenantModuleGuard.moduleForPath("/v1/approvalsx"));
        assertEquals("payroll", TenantModuleGuard.moduleForPath("/v1/payroll/runs"));
    }
}
