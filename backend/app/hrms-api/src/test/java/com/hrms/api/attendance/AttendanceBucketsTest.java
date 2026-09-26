package com.hrms.api.attendance;

import com.hrms.attendance.entity.AttendanceRecord;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
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

    // A punch on a weekly off used to be invisible: the roster was filtered on
    // the weekly off before any record was read, so Daily Logs and the team
    // payload both dropped the person who had actually come in.
    private static final LocalDate SATURDAY = LocalDate.of(2026, 9, 26);
    private static final Set<Integer> SAT_SUN = Set.of(6, 7);

    @Test void whoeverPunchedIsOnTheDayRosterEvenOnTheirWeeklyOff() {
        assertFalse(AttendanceController.onDayRoster(SATURDAY, null, null, SAT_SUN, false), "off and no punch");
        assertTrue(AttendanceController.onDayRoster(SATURDAY, null, null, SAT_SUN, true), "off but came in");
        assertTrue(AttendanceController.onDayRoster(SATURDAY, null, null, Set.of(7), false), "a working Saturday");
        assertTrue(AttendanceController.onDayRoster(SATURDAY, null, null, null, false), "no weekly offs known");
    }

    @Test void aPunchDoesNotPutAFutureHireOrAPastLeaverOnTheRoster() {
        assertFalse(AttendanceController.onDayRoster(SATURDAY, SATURDAY.plusDays(5), null, Set.of(7), true), "joins later");
        assertFalse(AttendanceController.onDayRoster(SATURDAY, null, SATURDAY.minusDays(1), Set.of(7), true), "already left");
        assertTrue(AttendanceController.onDayRoster(SATURDAY, SATURDAY, SATURDAY, Set.of(7), false), "joins and leaves that day");
    }

    @Test void theWeeklyOffTallyIgnoresPunchesButNotJoiningAndLeaving() {
        assertTrue(AttendanceController.onWeeklyOff(SATURDAY, null, null, SAT_SUN));
        assertFalse(AttendanceController.onWeeklyOff(SATURDAY, null, null, Set.of(7)));
        assertFalse(AttendanceController.onWeeklyOff(SATURDAY, SATURDAY.plusDays(1), null, SAT_SUN), "not hired yet");
        assertFalse(AttendanceController.onWeeklyOff(SATURDAY, null, SATURDAY.minusDays(1), SAT_SUN), "already left");
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
