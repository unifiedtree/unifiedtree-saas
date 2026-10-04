package com.hrms.attendance.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.hrms.attendance.client.FaceRecognitionClient;
import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.CheckInRequest;
import com.hrms.attendance.dto.ManualAttendanceRequest;
import com.hrms.attendance.dto.PunchInRecordedEvent;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.enums.AttendanceStatus;
import com.hrms.attendance.mapper.AttendanceMapper;
import com.hrms.attendance.repository.AttendanceCorrectionRequestRepository;
import com.hrms.attendance.repository.AttendanceEventLogRepository;
import com.hrms.attendance.repository.AttendanceRecordRepository;
import com.hrms.attendance.repository.GeoFenceZoneRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.kafka.core.KafkaTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Punch-in alerts (V143.72) start here: every saved punch-in publishes a
 * {@link PunchInRecordedEvent} (sent after the commit, by PunchAlertNotifier),
 * handing it over can never fail the punch, and HR's manual entries are not
 * punches. Also: the check-in body's optional {@code accuracy}.
 */
class PunchInEventTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID EMP = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    private final AttendanceRecordRepository records = mock(AttendanceRecordRepository.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);

    @SuppressWarnings("unchecked")
    private AttendanceService service() {
        AttendanceService s = new AttendanceService(records, mock(AttendanceEventLogRepository.class),
                mock(AttendanceCorrectionRequestRepository.class), mock(GeoFenceZoneRepository.class),
                mock(FaceRecognitionClient.class), mock(GeoValidationService.class), mock(KafkaTemplate.class),
                mock(AttendanceMapper.class), events, 0.92, false, false);
        when(records.findByEmployeeIdAndAttendanceDate(any(), any())).thenReturn(Optional.empty());
        when(records.save(any())).thenAnswer(inv -> {
            AttendanceRecord r = inv.getArgument(0);
            if (r.getId() == null) r.setId(UUID.randomUUID());
            return r;
        });
        return s;
    }

    private AttendanceDto punch(AttendanceService s, String method, Double accuracy) {
        return s.checkInJson(EMP, COMPANY, null, null, 17.385040, 78.486670, null, method, TENANT,
                "Head Office", null, "Pixel 8", UUID.randomUUID().toString(), false, false, null, accuracy);
    }

    @Test void aPunchInPublishesWhoWhenHowAndWhere() {
        AttendanceService s = service();
        AttendanceDto dto = punch(s, "WEB", 14.5);

        ArgumentCaptor<Object> sent = ArgumentCaptor.forClass(Object.class);
        verify(events).publishEvent(sent.capture());
        PunchInRecordedEvent e = assertInstanceOf(PunchInRecordedEvent.class, sent.getValue());
        ArgumentCaptor<AttendanceRecord> saved = ArgumentCaptor.forClass(AttendanceRecord.class);
        verify(records).save(saved.capture());
        AttendanceRecord r = saved.getValue();
        assertEquals(TENANT, e.tenantId());
        assertEquals(r.getId(), e.attendanceRecordId());
        assertEquals(dto.id(), e.attendanceRecordId());
        assertEquals(EMP, e.employeeId());
        assertEquals(COMPANY, e.companyId());
        assertEquals(r.getCheckInAt(), e.checkInAt());
        assertEquals("WEB", e.method());
        assertEquals(17.385040, e.latitude());
        assertEquals(78.486670, e.longitude());
        assertEquals(14.5, e.accuracyMeters());
        assertEquals(r.getAttendanceStatus() == AttendanceStatus.LATE, e.late());
        assertEquals(r.getLateByMinutes(), e.lateByMinutes());
        assertFalse(e.wfhDay());
        assertFalse(e.offlineCaptured(), "an online punch is stamped by the server clock");
    }

    @Test void theOldOverloadStillPunchesWithoutAnAccuracy() {
        AttendanceService s = service();
        s.checkInJson(EMP, COMPANY, null, null, 17.4, 78.4, null, "FACE_RECOGNITION", TENANT,
                null, null, null, null, true, false, null);
        ArgumentCaptor<Object> sent = ArgumentCaptor.forClass(Object.class);
        verify(events).publishEvent(sent.capture());
        PunchInRecordedEvent e = assertInstanceOf(PunchInRecordedEvent.class, sent.getValue());
        assertNull(e.accuracyMeters());
        assertTrue(e.wfhDay(), "an approved work-from-home day is filed as WFH");
        assertEquals("FACE_RECOGNITION", e.method());
    }

    @Test void aFailureToHandOverTheAlertNeverFailsThePunch() {
        AttendanceService s = service();
        doThrow(new IllegalStateException("listener exploded")).when(events).publishEvent(any(Object.class));
        AttendanceDto dto = assertDoesNotThrow(() -> punch(s, "FACE_RECOGNITION", null));
        assertNotNull(dto);
        verify(records).save(any());
    }

    @Test void aRepeatedOfflinePunchIsNotAnnouncedTwice() {
        AttendanceService s = service();
        AttendanceRecord already = new AttendanceRecord();
        already.setId(UUID.randomUUID());
        already.setEmployeeId(EMP);
        already.setAttendanceDate(LocalDate.now());
        when(records.findByClientEventId("evt-1")).thenReturn(Optional.of(already));
        s.checkInJson(EMP, COMPANY, null, null, 17.4, 78.4, null, "FACE_RECOGNITION", TENANT,
                null, null, null, "evt-1", false, true, Instant.now(), null);
        verify(events, never()).publishEvent(any(Object.class));
        verify(records, never()).save(any());
    }

    @Test void aManualEntryByHrIsNotAPunchAndSendsNoAlert() {
        AttendanceService s = service();
        LocalDate day = LocalDate.of(2026, 10, 5);
        s.manualEntry(new ManualAttendanceRequest(EMP, day, Instant.parse("2026-10-05T04:00:00Z"), null,
                        "OFFICE", null, 17.4, 78.4, "Head Office", "Forgot the phone"),
                UUID.randomUUID(), TENANT, COMPANY, null, null);
        verify(records).save(any());
        verify(events, never()).publishEvent(any(Object.class));
    }

    @Test void theCheckInBodyTakesAnOptionalAccuracy() throws Exception {
        ObjectMapper json = new ObjectMapper().registerModule(new JavaTimeModule());
        CheckInRequest with = json.readValue("""
                {"latitude":17.4,"longitude":78.4,"checkInMethod":"WEB","accuracy":12.5,"offlineCaptured":false}
                """, CheckInRequest.class);
        assertEquals(12.5, with.accuracy());
        assertEquals("WEB", with.checkInMethod());
        CheckInRequest without = json.readValue("""
                {"latitude":17.4,"longitude":78.4,"checkInMethod":"FACE_RECOGNITION","capturedAt":"2026-10-05T04:12:00Z","offlineCaptured":true}
                """, CheckInRequest.class);
        assertNull(without.accuracy());
        assertEquals(Instant.parse("2026-10-05T04:12:00Z"), without.capturedAt());
        assertTrue(without.offlineCaptured());
        // The shape before accuracy still builds.
        assertNull(new CheckInRequest(1, 2, null, "GPS", null, null, null, null, false, null).accuracy());
    }
}
