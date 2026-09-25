package com.hrms.api.attendance;

import com.hrms.attendance.entity.AttendanceRecord;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class AttendanceBucketsTest {
    // Permission-based since V143.17 (w1h): company scope follows attendance.workforce.admin,
    // team scope follows attendance.team.read, whatever the role is called.
    @Test void companyScopeFollowsWorkforceAdminAndTeamScopeFollowsTeamRead() {
        var admin = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("test").header("alg", "none")
                .claim("roles", List.of("ANY_ROLE")).claim("permissions", List.of("attendance.workforce.admin", "attendance.team.read")).build();
        assertTrue(AttendanceController.isAdmin(admin));
        var manager = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("test").header("alg", "none")
                .claim("roles", List.of("OWNER")).claim("permissions", List.of("attendance.team.read")).build();
        assertFalse(AttendanceController.isAdmin(manager), "a role name alone no longer grants company scope");
        assertTrue(AttendanceController.isManagerOrAdmin(manager));
        var employee = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("test").header("alg", "none")
                .claim("roles", List.of("MANAGER")).claim("permissions", List.of("attendance.checkin.self")).build();
        assertFalse(AttendanceController.isManagerOrAdmin(employee));
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
