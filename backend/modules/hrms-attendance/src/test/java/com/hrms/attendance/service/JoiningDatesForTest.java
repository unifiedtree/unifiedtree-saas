package com.hrms.attendance.service;

import com.hrms.attendance.client.FaceRecognitionClient;
import com.hrms.attendance.mapper.AttendanceMapper;
import com.hrms.attendance.repository.AttendanceCorrectionRequestRepository;
import com.hrms.attendance.repository.AttendanceEventLogRepository;
import com.hrms.attendance.repository.AttendanceRecordRepository;
import com.hrms.attendance.repository.GeoFenceZoneRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * The team dashboard's roster (and its trend) leaves out people who join after
 * the day. Someone with no joining date counts from the day their record was
 * created (India time), as the admin dashboard's headcount does (7 Oct 2026:
 * the roster used to count them on every day, the headcount on none today).
 */
class JoiningDatesForTest {

    @Test
    @SuppressWarnings("unchecked")
    void aMissingJoiningDateIsTheDayTheRecordWasCreated() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AttendanceService s = new AttendanceService(mock(AttendanceRecordRepository.class), mock(AttendanceEventLogRepository.class),
                mock(AttendanceCorrectionRequestRepository.class), mock(GeoFenceZoneRepository.class),
                mock(FaceRecognitionClient.class), mock(GeoValidationService.class), mock(KafkaTemplate.class),
                mock(AttendanceMapper.class), mock(ApplicationEventPublisher.class), 0.92, false, false);
        ReflectionTestUtils.setField(s, "jdbcTemplate", jdbc);
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        s.joiningDatesFor(List.of(a, b));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(RowCallbackHandler.class), any(), any());
        assertTrue(sql.getValue().contains("COALESCE(date_of_joining, (created_at AT TIME ZONE 'Asia/Kolkata')::date) AS date_of_joining"), sql.getValue());
        assertTrue(sql.getValue().contains("WHERE id IN (?,?)"), sql.getValue());
    }
}
