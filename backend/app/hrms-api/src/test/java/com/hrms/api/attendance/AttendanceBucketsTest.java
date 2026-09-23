package com.hrms.api.attendance;

import com.hrms.attendance.entity.AttendanceRecord;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class AttendanceBucketsTest {
    @Test void workspaceOwnersAndAdminsGetCompanyScopeButManagersDoNot() {
        for (String role : List.of("OWNER", "ADMIN", "COMPANY_ADMIN", "HR_MANAGER")) {
            var jwt = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("test").header("alg", "none")
                    .claim("roles", List.of(role)).build();
            assertTrue(AttendanceController.isAdmin(jwt), role);
        }
        var manager = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("test").header("alg", "none")
                .claim("roles", List.of("MANAGER")).build();
        assertFalse(AttendanceController.isAdmin(manager));
        assertTrue(AttendanceController.isManagerOrAdmin(manager));
    }
    private AttendanceRecord record(String status, String type, boolean punched) {
        AttendanceRecord row = new AttendanceRecord();
        if (punched) row.setCheckInAt(Instant.parse("2026-09-22T05:00:00Z"));
        row.setAttendanceStatus(status == null ? null : com.hrms.attendance.enums.AttendanceStatus.valueOf(status));
        row.setAttendanceType(type == null ? null : com.hrms.attendance.enums.AttendanceType.valueOf(type));
        return row;
    }

    @Test void overlappingLateWfhMustNotSubtractAnUnrelatedPresentEmployee() {
        var rows = List.of(record("LATE", "WFH", true), record("ON_TIME", null, true));
        assertEquals(1, rows.stream().filter(AttendanceController::isPresentBucket).count());
    }

    @Test void onlyCheckedInRowsOutsideSpecificBucketsArePresent() {
        assertFalse(AttendanceController.isPresentBucket(record(null, null, false)));
        assertFalse(AttendanceController.isPresentBucket(record("HALF_DAY", "WFH", true)));
        assertFalse(AttendanceController.isPresentBucket(record("LATE", null, true)));
        assertFalse(AttendanceController.isPresentBucket(record("ON_TIME", "WFH", true)));
        assertTrue(AttendanceController.isPresentBucket(record("ON_TIME", null, true)));
    }
}
