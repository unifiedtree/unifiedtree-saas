package com.unifiedtree.attendance.face.service;

import com.unifiedtree.attendance.face.crypto.EmbeddingCipher;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentCompleteResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStartRequest;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStatus;
import com.unifiedtree.attendance.face.dto.FaceDtos.PersonEnrollmentStatusResponse;
import com.unifiedtree.attendance.face.worker.FaceWorkerClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.stubbing.Answer;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * HR enrolling someone else from the web (V143.41 wave): the HR employee id is
 * mapped to the person's login, a locked record is unlocked before it is
 * replaced, and a finished enrollment writes one audit entry that can never
 * break the enrollment itself.
 */
class FaceAdminEnrollmentTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID EMPLOYEE = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID LOGIN = UUID.fromString("66666666-6666-6666-6666-666666666666");
    private static final UUID HR = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID ENROLLMENT = UUID.fromString("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");

    private JdbcTemplate jdbc;
    private FaceWriter writer;
    private FaceService face;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        writer = mock(FaceWriter.class);
        face = new FaceService(jdbc, writer, mock(FaceWorkerClient.class), mock(EmbeddingCipher.class),
                mock(ApplicationEventPublisher.class), true, 0.75, 0.07, 0.05, 2, 0.55, true, 0.35, 8, 0, "sface", "sface-1.0");
    }

    private void logins(UUID... ids) {
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(UUID.class), any(), any()))
                .thenReturn(List.of(ids));
    }

    /** One attendance.face_enrollments row, built through the service's own row mapper. */
    @SuppressWarnings("unchecked")
    private static Answer<Object> row(String status, int samples) {
        return inv -> {
            RowMapper<Object> mapper = inv.getArgument(1);
            ResultSet rs = mock(ResultSet.class);
            when(rs.getString("id")).thenReturn(ENROLLMENT.toString());
            when(rs.getString("status")).thenReturn(status);
            when(rs.getInt("samples_captured")).thenReturn(samples);
            return mapper.mapRow(rs, 0);
        };
    }

    @SuppressWarnings("unchecked")
    private void enrollmentRows(Answer<Object> first, Answer<Object> second) {
        when(jdbc.queryForObject(contains("FROM attendance.face_enrollments"), any(RowMapper.class), any(), any()))
                .thenAnswer(first).thenAnswer(second);
    }

    @Test
    void personWithoutLoginIsNotEnrolledAndCannotBeEnrolled() {
        logins();
        PersonEnrollmentStatusResponse s = face.personStatus(TENANT, EMPLOYEE);
        assertThat(s.hasLogin()).isFalse();
        assertThat(s.status()).isEqualTo(EnrollmentStatus.PENDING);
        assertThat(s.enrolledAt()).isNull();

        assertThatThrownBy(() -> face.requireLoginFor(TENANT, EMPLOYEE))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> {
                    ResponseStatusException rse = (ResponseStatusException) e;
                    assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(rse.getReason()).startsWith("FACE_NO_LOGIN:");
                });
    }

    @Test
    void employeeIdIsMappedToTheirLogin() {
        logins(LOGIN);
        assertThat(face.requireLoginFor(TENANT, EMPLOYEE)).isEqualTo(LOGIN);
    }

    @Test
    void hrStartUnlocksALockedRecordBeforeReplacingIt() {
        enrollmentRows(row("LOCKED", 3), row("ACTIVE", 3));
        when(writer.upsertPendingEnrollment(TENANT, LOGIN, 3)).thenReturn(ENROLLMENT);

        assertThat(face.adminStartEnrollment(TENANT, LOGIN, new EnrollmentStartRequest(null)).enrollmentId())
                .isEqualTo(ENROLLMENT);
        var order = inOrder(writer);
        order.verify(writer).clearLock(TENANT, LOGIN);
        order.verify(writer).upsertPendingEnrollment(TENANT, LOGIN, 3);
    }

    @Test
    void finishingAnEnrollmentWritesOneAuditEntry() {
        enrollmentRows(row("PENDING", 3), row("ACTIVE", 3));

        face.completeEnrollment(TENANT, LOGIN, HR);
        verify(writer).markEnrollmentActive(ENROLLMENT, HR);
        verify(writer).recordEnrollmentAudit(TENANT, LOGIN, HR);

        // The phone's success screen completes again; that repeat is not a new enrollment.
        face.completeEnrollment(TENANT, LOGIN, LOGIN);
        verify(writer, never()).recordEnrollmentAudit(TENANT, LOGIN, LOGIN);
    }

    @Test
    void aFailedAuditEntryNeverBreaksTheEnrollment() {
        enrollmentRows(row("PENDING", 3), row("PENDING", 3));
        doThrow(new RuntimeException("audit down")).when(writer).recordEnrollmentAudit(TENANT, LOGIN, LOGIN);

        EnrollmentCompleteResponse done = face.completeEnrollment(TENANT, LOGIN, LOGIN);
        assertThat(done.status()).isEqualTo(EnrollmentStatus.ACTIVE);
        verify(writer).markEnrollmentActive(ENROLLMENT, LOGIN);
    }

    @Test
    void anUnfinishedEnrollmentIsNotCompletedOrAudited() {
        enrollmentRows(row("PENDING", 2), row("PENDING", 2));
        assertThatThrownBy(() -> face.completeEnrollment(TENANT, LOGIN, HR))
                .isInstanceOf(ResponseStatusException.class);
        verify(writer, never()).markEnrollmentActive(any(), any());
        verify(writer, never()).recordEnrollmentAudit(any(), any(), any());
        verify(writer, never()).upsertPendingEnrollment(any(), any(), anyInt());
    }
}
