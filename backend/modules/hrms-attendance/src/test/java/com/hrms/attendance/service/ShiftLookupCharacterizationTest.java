package com.hrms.attendance.service;

import com.hrms.attendance.client.FaceRecognitionClient;
import com.hrms.attendance.dto.ShiftDtos.EmployeeShiftResponse;
import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.mapper.AttendanceMapper;
import com.hrms.attendance.repository.AttendanceCorrectionRequestRepository;
import com.hrms.attendance.repository.AttendanceEventLogRepository;
import com.hrms.attendance.repository.AttendanceRecordRepository;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import com.hrms.attendance.repository.GeoFenceZoneRepository;
import com.hrms.attendance.repository.ShiftPolicyRepository;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * How the attendance copies of "which shift does this person have on this date" (shift-ot GAP-MAP §2.2) behave when
 * there is no database, or when the database fails, and how the shift service's own lookup picks a row, as they were
 * before the copies were replaced by one resolver. The answers on real data are pinned by the opt-in
 * {@code EffectiveShiftCharacterizationSqlTest} in hrms-api.
 */
class ShiftLookupCharacterizationTest {

    private static final UUID EMP = UUID.randomUUID();
    private static final LocalDate DAY = LocalDate.of(2026, 8, 5);

    @SuppressWarnings("unchecked")
    private static AttendanceService attendance(JdbcTemplate jdbc) {
        AttendanceService s = new AttendanceService(mock(AttendanceRecordRepository.class), mock(AttendanceEventLogRepository.class),
                mock(AttendanceCorrectionRequestRepository.class), mock(GeoFenceZoneRepository.class), mock(FaceRecognitionClient.class),
                mock(GeoValidationService.class), mock(KafkaTemplate.class), mock(AttendanceMapper.class),
                mock(ApplicationEventPublisher.class), 0.92, false, false);
        if (jdbc != null) ReflectionTestUtils.setField(s, "jdbcTemplate", jdbc);
        return s;
    }

    /** A database that refuses every query. */
    private static JdbcTemplate failing() {
        return mock(JdbcTemplate.class, inv -> {
            throw new DataAccessResourceFailureException("database down");
        });
    }

    @Test void withoutADatabaseNobodyHasAShift() {
        AttendanceService s = attendance(null);
        assertNull(s.getShiftProfile(EMP, DAY));
        assertEquals(Map.of(), s.getShiftWindowsForEmployees(List.of(EMP), DAY));
        assertEquals(Map.of(), s.getShiftEndInstantsForEmployees(List.of(EMP), DAY));
        assertNull(ReflectionTestUtils.invokeMethod(s, "lookupDailyTargetHours", EMP, DAY));
        assertEquals(8.0, (double) ReflectionTestUtils.invokeMethod(s, "overtimeThresholdHours", EMP, DAY));
        assertEquals(LocalTime.of(9, 30), ReflectionTestUtils.invokeMethod(s, "lateThresholdFor", EMP, DAY));
        assertEquals(Map.of(), s.weeklyOffSetsFor(List.of(EMP)));
    }

    @Test void noPersonOrNoDateMeansNoShift() {
        AttendanceService s = attendance(failing());
        assertNull(s.getShiftProfile(null, DAY));
        assertEquals(Map.of(), s.getShiftWindowsForEmployees(List.of(), DAY));
        assertEquals(Map.of(), s.getShiftWindowsForEmployees(null, DAY));
        assertEquals(Map.of(), s.getShiftEndInstantsForEmployees(List.of(), DAY));
        assertNull(ReflectionTestUtils.invokeMethod(s, "lookupDailyTargetHours", null, DAY));
        assertEquals(8.0, (double) ReflectionTestUtils.invokeMethod(s, "overtimeThresholdHours", null, DAY));
        assertEquals(8.0, (double) ReflectionTestUtils.invokeMethod(s, "overtimeThresholdHours", EMP, null));
    }

    @Test void aFailingLookupFallsBackForOneCallerAndFailsForAnother() {
        AttendanceService s = attendance(failing());
        // Late marks, my day and the weekly target swallow the failure: no shift.
        assertNull(s.getShiftProfile(EMP, DAY));
        assertNull(ReflectionTestUtils.invokeMethod(s, "lookupDailyTargetHours", EMP, DAY));
        assertEquals(LocalTime.of(9, 30), ReflectionTestUtils.invokeMethod(s, "lateThresholdFor", EMP, DAY));
        // Overtime falls back to 8 hours.
        assertEquals(8.0, (double) ReflectionTestUtils.invokeMethod(s, "overtimeThresholdHours", EMP, DAY));
        // The dashboard's batch lookups let it through (the dashboard catches it itself).
        assertThrows(DataAccessResourceFailureException.class, () -> s.getShiftWindowsForEmployees(List.of(EMP), DAY));
        assertThrows(DataAccessResourceFailureException.class, () -> s.getShiftEndInstantsForEmployees(List.of(EMP), DAY));
    }

    @Test void theCalendarsShiftStepIsSkippedWhenItFails() {
        JdbcTemplate jdbc = failing();
        assertEquals(Map.of(), AttendanceCalendar.shiftWeeklyOffDays(jdbc, List.of(EMP), DAY));
        assertEquals(Map.of(), AttendanceCalendar.shiftWeeklyOffDays(jdbc, List.of(), DAY));
        assertEquals(Map.of(), AttendanceCalendar.shiftWeeklyOffDays(jdbc, List.of(EMP), null));
        assertEquals(Map.of(), AttendanceCalendar.shiftWeeklyOffDays(null, List.of(EMP), DAY));
        assertEquals(Map.of(EMP, Set.of(6, 7)), AttendanceCalendar.resolveWeeklyOffDays(jdbc, List.of(EMP), DAY));
        assertEquals(Map.of(EMP, Set.of(6, 7)), AttendanceCalendar.resolveWeeklyOffDays(null, List.of(EMP), DAY));
        assertEquals(Map.of(), AttendanceCalendar.resolveWeeklyOffDays(jdbc, List.of(), DAY));
    }

    // ── EmployeeShiftService: the profile's current shift and the change request's baseline (JPA) ─────────────────

    private final ShiftPolicyRepository policies = mock(ShiftPolicyRepository.class);
    private final EmployeeShiftAssignmentRepository assignments = mock(EmployeeShiftAssignmentRepository.class);
    private final EmployeeShiftService shifts = new EmployeeShiftService(policies, assignments);
    private final LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    private EmployeeShiftAssignment row(UUID policy, LocalDate from, LocalDate to) {
        EmployeeShiftAssignment a = new EmployeeShiftAssignment();
        a.setEmployeeId(EMP);
        a.setShiftPolicyId(policy);
        a.setEffectiveFrom(from);
        a.setEffectiveTo(to);
        return a;
    }

    @Test void theFirstRowTheRepositoryGivesIsInForceWhateverItsShift() {
        UUID archived = UUID.randomUUID(), older = UUID.randomUUID();
        ShiftPolicy p = new ShiftPolicy();
        p.setId(archived);
        p.setName("Archived");
        p.setActive(false);
        when(policies.findById(archived)).thenReturn(Optional.of(p));
        // The repository orders by start, latest first; the service never looks past the first row, even when that
        // row's shift is archived and an older row still covers the day.
        when(assignments.findEffectiveOn(EMP, today)).thenReturn(List.of(row(archived, today.minusDays(2), null),
                row(older, today.minusDays(30), null)));
        when(assignments.findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(EMP, today)).thenReturn(Optional.empty());
        EmployeeShiftResponse r = shifts.getCurrentShift(EMP);
        assertEquals(archived, r.shiftPolicyId());
        assertEquals("Archived", r.shiftName());
        assertEquals(today.minusDays(2), r.effectiveFrom());
        assertEquals(archived, shifts.shiftPolicyIdOn(EMP, today));
    }

    @Test void aRowWhoseShiftIsGoneStillCountsWithItsId() {
        UUID gone = UUID.randomUUID();
        when(policies.findById(gone)).thenReturn(Optional.empty());
        when(assignments.findEffectiveOn(EMP, today)).thenReturn(List.of(row(gone, today.minusDays(1), today.plusDays(3))));
        when(assignments.findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(EMP, today)).thenReturn(Optional.empty());
        EmployeeShiftResponse r = shifts.getCurrentShift(EMP);
        assertEquals(gone, r.shiftPolicyId());
        assertNull(r.shiftName());
        assertEquals(0, r.gracePeriodMinutes());
        assertEquals(today.plusDays(3), r.effectiveTo());
        assertEquals(gone, shifts.shiftPolicyIdOn(EMP, today));
    }

    @Test void noRowNoShift() {
        when(assignments.findEffectiveOn(EMP, DAY)).thenReturn(List.of());
        assertNull(shifts.shiftPolicyIdOn(EMP, DAY));
    }
}
