package com.hrms.attendance.service;

import com.hrms.attendance.client.FaceRecognitionClient;
import com.hrms.attendance.dto.CorrectionDecisionRequest;
import com.hrms.attendance.dto.DayRecordResponse;
import com.hrms.attendance.entity.AttendanceCorrectionRequest;
import com.hrms.attendance.entity.AttendanceEventLog;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.enums.AttendanceEventType;
import com.hrms.attendance.enums.AttendanceType;
import com.hrms.attendance.enums.CheckInMethod;
import com.hrms.attendance.mapper.AttendanceMapper;
import com.hrms.attendance.repository.AttendanceCorrectionRequestRepository;
import com.hrms.attendance.repository.AttendanceEventLogRepository;
import com.hrms.attendance.repository.AttendanceRecordRepository;
import com.hrms.attendance.repository.GeoFenceZoneRepository;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The attendance service's own-day changes (V143.53 redesign): approving a fix
 * keeps a work-from-home day as WFH (bug E28), breaks never change the record
 * or its worked hours (an open break ends at check-out), and undo check-out
 * restores the day exactly as before checking out, only within 10 minutes.
 */
class AttendanceSelfDayTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final UUID EMP = UUID.randomUUID();
    private static final UUID TENANT = UUID.randomUUID();

    private final AttendanceRecordRepository records = mock(AttendanceRecordRepository.class);
    private final AttendanceEventLogRepository events = mock(AttendanceEventLogRepository.class);
    private final AttendanceCorrectionRequestRepository corrections = mock(AttendanceCorrectionRequestRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final List<AttendanceEventLog> logged = new ArrayList<>();

    @SuppressWarnings("unchecked")
    private AttendanceService service(boolean withJdbc) {
        AttendanceService s = new AttendanceService(records, events, corrections, mock(GeoFenceZoneRepository.class),
                mock(FaceRecognitionClient.class), mock(GeoValidationService.class), mock(KafkaTemplate.class),
                mock(AttendanceMapper.class), mock(ApplicationEventPublisher.class), 0.92, false, false);
        if (withJdbc) ReflectionTestUtils.setField(s, "jdbcTemplate", jdbc);
        when(events.save(any())).thenAnswer(inv -> { logged.add(inv.getArgument(0)); return inv.getArgument(0); });
        when(events.findByEmployeeIdInAndEventDateOrderByEventAtAsc(anyList(), any())).thenAnswer(inv -> new ArrayList<>(logged));
        when(records.save(any())).thenAnswer(inv -> inv.getArgument(0));
        return s;
    }

    private static AttendanceRecord record(LocalDate day, Instant in, Instant out) {
        AttendanceRecord r = new AttendanceRecord();
        r.setId(UUID.randomUUID());
        r.setTenantId(TENANT);
        r.setEmployeeId(EMP);
        r.setCompanyId(UUID.randomUUID());
        r.setAttendanceDate(day);
        r.setCheckInAt(in);
        r.setCheckOutAt(out);
        r.setCheckInMethod(CheckInMethod.FACE_RECOGNITION);
        r.setAttendanceType(AttendanceType.OFFICE);
        return r;
    }

    // ── bug E28: a fixed work-from-home day stays work from home ─────────────

    @Test void theTypeRuleKeepsWhatTheDayAlreadyIs() {
        assertEquals(AttendanceType.WFH, AttendanceService.correctedAttendanceType(AttendanceType.WFH, false));
        assertEquals(AttendanceType.FIELD_WORK, AttendanceService.correctedAttendanceType(AttendanceType.FIELD_WORK, false));
        assertEquals(AttendanceType.OFFICE, AttendanceService.correctedAttendanceType(AttendanceType.OFFICE, true));
        assertEquals(AttendanceType.WFH, AttendanceService.correctedAttendanceType(null, true));
        assertEquals(AttendanceType.OFFICE, AttendanceService.correctedAttendanceType(null, false));
    }

    private AttendanceRecord approveFixOn(AttendanceRecord existing, boolean approvedWfhDay) {
        LocalDate day = LocalDate.of(2026, 9, 21);
        AttendanceService s = service(true);
        AttendanceCorrectionRequest c = new AttendanceCorrectionRequest();
        c.setId(UUID.randomUUID());
        c.setTenantId(TENANT);
        c.setEmployeeId(EMP);
        c.setCompanyId(UUID.randomUUID());
        c.setMissingForDate(day);
        c.setRequestedCheckOutAt(day.atTime(18, 30).atZone(IST).toInstant());
        c.setReason("Forgot to punch out");
        c.setStatus(ApprovalStatus.PENDING);
        when(corrections.findById(c.getId())).thenReturn(Optional.of(c));
        when(corrections.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(records.findByEmployeeIdAndAttendanceDate(EMP, day)).thenReturn(Optional.ofNullable(existing));
        // isApprovedWfhDay reads leave_mgmt.wfh_requests.
        when(jdbc.query(contains("wfh_requests"), any(ResultSetExtractor.class), eq(EMP), any(), any()))
                .thenReturn(approvedWfhDay ? 1 : null);
        s.decideCorrection(c.getId(), UUID.randomUUID(), new CorrectionDecisionRequest(ApprovalStatus.APPROVED, "ok"));
        ArgumentCaptor<AttendanceRecord> saved = ArgumentCaptor.forClass(AttendanceRecord.class);
        verify(records).save(saved.capture());
        return saved.getValue();
    }

    @Test void approvingAFixOnAWorkFromHomeDayKeepsItWorkFromHome() {
        LocalDate day = LocalDate.of(2026, 9, 21);
        AttendanceRecord wfh = record(day, day.atTime(9, 5).atZone(IST).toInstant(), null);
        wfh.setAttendanceType(AttendanceType.WFH);
        assertEquals(AttendanceType.WFH, approveFixOn(wfh, true).getAttendanceType());
    }

    @Test void anOfficeDayStaysAnOfficeDay() {
        LocalDate day = LocalDate.of(2026, 9, 21);
        assertEquals(AttendanceType.OFFICE, approveFixOn(record(day, day.atTime(9, 5).atZone(IST).toInstant(), null), false).getAttendanceType());
    }

    @Test void aMissingDayOnAnApprovedWorkFromHomeDayBecomesWorkFromHome() {
        assertEquals(AttendanceType.WFH, approveFixOn(null, true).getAttendanceType());
    }

    @Test void aMissingOrdinaryDayIsStillAnOfficeDay() {
        assertEquals(AttendanceType.OFFICE, approveFixOn(null, false).getAttendanceType());
    }

    // ── breaks: the event log only ───────────────────────────────────────────

    @Test void aBreakIsAnEventAndNeverTouchesTheRecord() {
        AttendanceService s = service(false);
        Instant now = Instant.now();
        LocalDate today = now.atZone(IST).toLocalDate();
        AttendanceRecord open = record(today, now.minus(Duration.ofMinutes(5)), null);
        open.setWorkingHours(null);
        when(records.findByEmployeeIdAndAttendanceDate(EMP, today)).thenReturn(Optional.of(open));

        SelfPunchRules.BreakState started = s.startBreak(EMP, now);
        assertTrue(started.onBreak());
        assertEquals(AttendanceEventType.BREAK_START, logged.get(0).getEventType());
        assertEquals(open.getId(), logged.get(0).getAttendanceRecordId());
        assertThrows(BusinessRuleException.class, () -> s.startBreak(EMP, now.plusSeconds(60)));

        SelfPunchRules.BreakState ended = s.endBreak(EMP, now.plusSeconds(120));
        assertFalse(ended.onBreak());
        assertEquals(AttendanceEventType.BREAK_END, logged.get(1).getEventType());
        verify(records, never()).save(any());
        assertNull(open.getWorkingHours());
        assertThrows(BusinessRuleException.class, () -> s.endBreak(EMP, now.plusSeconds(180)));
    }

    @Test void noBreakWithoutBeingCheckedIn() {
        AttendanceService s = service(false);
        Instant now = Instant.now();
        when(records.findByEmployeeIdAndAttendanceDate(eq(EMP), any())).thenReturn(Optional.empty());
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> s.startBreak(EMP, now));
        assertEquals(SelfPunchRules.NOT_CHECKED_IN, e.getErrorCode());
    }

    @Test void checkOutEndsAnOpenBreakAndWorkedHoursStayCheckInToCheckOut() {
        AttendanceService s = service(false);
        Instant now = Instant.now();
        LocalDate today = now.atZone(IST).toLocalDate();
        AttendanceRecord open = record(today, now.minus(Duration.ofMinutes(120)), null);
        when(records.findByEmployeeIdAndAttendanceDate(eq(EMP), any())).thenReturn(Optional.of(open));
        AttendanceEventLog start1 = new AttendanceEventLog();
        start1.setAttendanceRecordId(open.getId());
        start1.setEventType(AttendanceEventType.BREAK_START);
        start1.setEventAt(now.minus(Duration.ofMinutes(90)));
        AttendanceEventLog end1 = new AttendanceEventLog();
        end1.setAttendanceRecordId(open.getId());
        end1.setEventType(AttendanceEventType.BREAK_END);
        end1.setEventAt(now.minus(Duration.ofMinutes(60)));
        AttendanceEventLog start2 = new AttendanceEventLog();
        start2.setAttendanceRecordId(open.getId());
        start2.setEventType(AttendanceEventType.BREAK_START);
        start2.setEventAt(now.minus(Duration.ofMinutes(10)));
        logged.addAll(List.of(start1, end1, start2));

        s.checkOut(EMP);

        assertEquals(2.0, open.getWorkingHours(), 0.001, "breaks are not taken off worked hours");
        AttendanceEventLog last = logged.get(logged.size() - 1);
        assertEquals(AttendanceEventType.BREAK_END, last.getEventType());
        assertEquals(open.getCheckOutAt(), last.getEventAt());
        assertFalse(SelfPunchRules.breaks(logged, open.getCheckOutAt()).onBreak());
    }

    // ── undo check-out ───────────────────────────────────────────────────────

    private static final LocalDate DAY = LocalDate.of(2026, 9, 28);
    private static Instant at(String hhmm) {
        return DAY.atTime(LocalTime.parse(hhmm)).atZone(IST).toInstant();
    }

    @Test void undoPutsTheDayBackAsItWasBeforeCheckingOut() {
        AttendanceService s = service(false);
        AttendanceRecord r = record(DAY, at("09:00"), at("18:00"));
        r.setCheckOutMethod(CheckInMethod.FACE_RECOGNITION);
        r.setCheckOutLatitude(17.1);
        r.setCheckOutLongitude(78.1);
        r.setCheckOutZoneName("HQ");
        r.setWorkingHours(9.0);
        r.setOvertimeMinutes(0);
        r.setLocationName("Checked out from the lobby");
        AttendanceEventLog checkIn = new AttendanceEventLog();
        checkIn.setAttendanceRecordId(r.getId());
        checkIn.setEventType(AttendanceEventType.CHECK_IN);
        checkIn.setEventAt(at("09:00"));
        checkIn.setLocationName("Head office");
        logged.add(checkIn);
        when(records.findByEmployeeIdAndAttendanceDate(EMP, DAY)).thenReturn(Optional.of(r));

        s.undoOwnCheckOut(EMP, at("18:06"));

        assertNull(r.getCheckOutAt());
        assertNull(r.getCheckOutMethod());
        assertNull(r.getCheckOutLatitude());
        assertNull(r.getCheckOutLongitude());
        assertNull(r.getCheckOutZoneName());
        assertNull(r.getWorkingHours());
        assertNull(r.getOvertimeMinutes());
        assertEquals("Head office", r.getLocationName());
        assertEquals(at("09:00"), r.getCheckInAt(), "the check-in is untouched");
        AttendanceEventLog last = logged.get(logged.size() - 1);
        assertEquals(AttendanceEventType.MANUAL_OVERRIDE, last.getEventType());
        assertTrue(last.getNote().contains("undone by the employee"));
    }

    @Test void undoAfterTenMinutesIsRefusedAndNothingChanges() {
        AttendanceService s = service(false);
        AttendanceRecord r = record(DAY, at("09:00"), at("18:00"));
        r.setWorkingHours(9.0);
        when(records.findByEmployeeIdAndAttendanceDate(EMP, DAY)).thenReturn(Optional.of(r));
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> s.undoOwnCheckOut(EMP, at("18:11")));
        assertEquals(SelfPunchRules.UNDO_WINDOW_PASSED, e.getErrorCode());
        assertEquals(at("18:00"), r.getCheckOutAt());
        assertEquals(9.0, r.getWorkingHours());
        verify(records, never()).save(any());
    }

    @Test void anHrEntryCantBeUndoneByTheEmployee() {
        AttendanceService s = service(false);
        AttendanceRecord r = record(DAY, at("09:00"), at("18:00"));
        r.setManualEntry(true);
        when(records.findByEmployeeIdAndAttendanceDate(EMP, DAY)).thenReturn(Optional.of(r));
        assertEquals(SelfPunchRules.UNDO_NOT_OWN,
                assertThrows(BusinessRuleException.class, () -> s.undoOwnCheckOut(EMP, at("18:02"))).getErrorCode());
    }

    // ── the month calendar's day details (BW-15) ─────────────────────────────

    @Test void dayDetailsComeFromTheRecordAndTheOldFieldsStay() {
        AttendanceRecord r = record(DAY, at("09:48"), at("18:40"));
        r.setCheckInMethod(CheckInMethod.WEB);
        r.setCheckOutMethod(CheckInMethod.WEB);
        r.setLocationName("Home");
        r.setRegularized(true);
        DayRecordResponse base = new DayRecordResponse("2026-09-28", "LATE", "t1", "t2", 8.87, "Late by 18 min", false);
        DayRecordResponse d = AttendanceService.withDetails(base, r, "WFH", 18);
        assertEquals("2026-09-28", d.date());
        assertEquals("LATE", d.status());
        assertEquals("t1", d.checkInTime());
        assertEquals("t2", d.checkOutTime());
        assertEquals(8.87, d.workHours());
        assertEquals("Late by 18 min", d.note());
        assertEquals("WFH", d.attendanceType());
        assertEquals(18, d.lateMinutes());
        assertEquals("WEB", d.checkInMethod());
        assertEquals("WEB", d.checkOutMethod());
        assertEquals("Home", d.locationName());
        assertEquals(Boolean.TRUE, d.regularized());
        // A day with no record knows nothing more than its status.
        DayRecordResponse none = AttendanceService.withDetails(new DayRecordResponse("2026-09-27", "ABSENT", null, null, null), null, null, null);
        assertNull(none.checkInMethod());
        assertNull(none.regularized());
    }
}
