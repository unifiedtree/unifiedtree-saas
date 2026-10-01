package com.hrms.api.attendance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.hrms.attendance.dto.CorrectionRequestResponse;
import com.hrms.attendance.dto.DayRecordResponse;
import com.hrms.attendance.dto.MonthlyStatsResponse;
import com.hrms.attendance.dto.StaffStatusResponse;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.enums.CheckInMethod;
import com.hrms.core.enums.ApprovalStatus;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The redesign's additive fields (BW-13, BW-15, BW-23): the roster row's leave
 * facts agree with {@code onLeave}, and every response the mobile app reads
 * keeps each of its old fields, with the same name and value, next to the new
 * ones.
 */
class RosterFactsTest {

    private static final UUID A = UUID.randomUUID();
    private static final UUID B = UUID.randomUUID();
    private static final LocalDate MON = LocalDate.of(2026, 9, 28);
    private final ObjectMapper json = new ObjectMapper().registerModule(new JavaTimeModule());

    @Test void theNewestApprovedLeaveNamesTheDayAndWaitingLeaveIsSeparate() {
        Map<UUID, AttendanceController.LeaveFacts> f = AttendanceController.leaveFacts(List.of(
                new AttendanceController.LeaveRow(A, "PENDING", MON, MON, "Sick leave"),
                new AttendanceController.LeaveRow(A, "APPROVED", MON.minusDays(1), MON.plusDays(1), "Casual leave"),
                new AttendanceController.LeaveRow(A, "APPROVED", MON, MON, "Earned leave"),
                new AttendanceController.LeaveRow(B, "PENDING_L2", MON, MON.plusDays(2), "Casual leave")));
        assertEquals("Casual leave", f.get(A).typeName());
        assertEquals(MON.minusDays(1), f.get(A).from());
        assertEquals(MON.plusDays(1), f.get(A).to());
        assertTrue(f.get(A).pending());
        assertNull(f.get(B).typeName(), "waiting leave never counts as on leave");
        assertTrue(f.get(B).pending());
    }

    private static StaffStatusResponse row(boolean onLeave) {
        return new StaffStatusResponse(A, "E-7", "Asha Rao", "Engineer", null, "Engineering", null, "ON_TIME",
                Instant.parse("2026-09-28T03:40:00Z"), null, "Head office", 17.4, 78.4, false, "OFFICE", onLeave,
                "General", Instant.parse("2026-09-28T04:00:00Z"), 15, null, "PRESENT", null, false, false, false,
                false, false, null, null);
    }

    @Test void leaveFactsShowOnlyOnARowThatIsOnApprovedLeave() {
        AttendanceController.LeaveFacts facts = new AttendanceController.LeaveFacts("Casual leave", MON, MON, true);
        StaffStatusResponse off = AttendanceController.withRosterFacts(row(true), "Bengaluru", null, facts);
        assertEquals("Casual leave", off.leaveTypeName());
        assertEquals(MON, off.leaveFrom());
        assertTrue(off.pendingLeave());
        StaffStatusResponse in = AttendanceController.withRosterFacts(row(false), "Bengaluru", null, facts);
        assertNull(in.leaveTypeName(), "not on approved leave: no leave type, whatever the lookup said");
        assertTrue(in.pendingLeave());
        assertEquals("Bengaluru", in.branchName());
    }

    @Test void theMethodComesFromTheDaysCheckIn() {
        AttendanceRecord r = new AttendanceRecord();
        r.setCheckInAt(Instant.parse("2026-09-28T03:40:00Z"));
        r.setCheckInMethod(CheckInMethod.WEB);
        assertEquals("WEB", AttendanceController.withRosterFacts(row(false), null, r, null).checkInMethod());
        assertNull(AttendanceController.withRosterFacts(row(false), null, new AttendanceRecord(), null).checkInMethod());
    }

    @Test void theRosterRowKeepsEveryOldFieldAndValue() throws Exception {
        StaffStatusResponse before = row(false);
        StaffStatusResponse after = AttendanceController.withRosterFacts(before, "Bengaluru", null,
                new AttendanceController.LeaveFacts(null, null, null, false));
        JsonNode old = json.valueToTree(before), now = json.valueToTree(after);
        for (String field : List.of("employeeId", "employeeCode", "fullName", "jobTitle", "departmentId", "departmentName",
                "profilePhotoUrl", "status", "checkInAt", "checkOutAt", "locationName", "latitude", "longitude",
                "earlyCheckout", "attendanceType", "onLeave", "shiftName", "expectedCheckInAt", "graceMinutes",
                "lateByMinutes", "effectiveStatus", "statusNote", "statusManual", "lossOfPay", "withinAllowance",
                "outsideGeofence", "punchRejected", "earlyByMinutes", "workedMinutes")) {
            assertTrue(now.has(field), field);
            assertEquals(old.get(field), now.get(field), field);
        }
        for (String added : List.of("branchName", "checkInMethod", "leaveTypeName", "leaveFrom", "leaveTo", "pendingLeave")) {
            assertTrue(now.has(added), added);
        }
    }

    @Test void theMonthAndStatsKeepTheirOldFields() {
        JsonNode day = json.valueToTree(new DayRecordResponse("2026-09-28", "PRESENT", "a", "b", 9.0, "n", true));
        for (String f : List.of("date", "status", "checkInTime", "checkOutTime", "workHours", "note", "manual")) assertTrue(day.has(f), f);
        assertEquals("PRESENT", day.get("status").asText());
        JsonNode stats = json.valueToTree(new MonthlyStatsResponse(17, 1, 1, 15, 2, 94));
        for (String f : List.of("presentDays", "absentDays", "holidays", "onTimeDays", "lateDays", "attendanceScore")) assertTrue(stats.has(f), f);
        assertEquals(94, stats.get("attendanceScore").asInt());
        assertTrue(stats.has("leaveDays"));
    }

    @Test void aFixRequestKeepsItsOldFieldsAndGainsTheNames() {
        UUID approver = UUID.randomUUID();
        CorrectionRequestResponse c = new CorrectionRequestResponse(UUID.randomUUID(), A, "Asha Rao", "E-7", "Engineering", null,
                MON, null, Instant.parse("2026-09-28T13:00:00Z"), "Forgot", null, ApprovalStatus.APPROVED, approver, "ok",
                Instant.parse("2026-09-28T14:00:00Z"), Instant.parse("2026-09-28T13:30:00Z"));
        CorrectionRequestResponse named = AttendanceController.withNames(c, null, "Dept Manager");
        JsonNode n = json.valueToTree(named);
        assertEquals(approver.toString(), n.get("approverId").asText());
        assertEquals("APPROVED", n.get("status").asText());
        assertEquals("Dept Manager", n.get("decidedByName").asText());
        assertTrue(n.has("approverName"));
    }

    // ── who a request goes to (the notification's path) ──────────────────────

    @Test void theApproverPathMatchesTheNotification() {
        UUID me = UUID.randomUUID(), mgr = UUID.randomUUID(), hr = UUID.randomUUID(), sa = UUID.randomUUID();
        assertEquals(mgr, ApproverPath.pick(me, mgr, hr, sa));
        assertEquals(hr, ApproverPath.pick(me, null, hr, sa), "no manager or head: HR");
        assertEquals(hr, ApproverPath.pick(me, me, hr, sa), "never yourself");
        assertEquals(sa, ApproverPath.pick(hr, null, hr, sa), "HR's own request: the super admin");
        assertNull(ApproverPath.pick(sa, null, sa, sa));
    }
}
