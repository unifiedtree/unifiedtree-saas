package com.unifiedtree.attendance.face.service;

import com.unifiedtree.attendance.face.crypto.EmbeddingCipher;
import com.unifiedtree.attendance.face.dto.FaceDtos.AdminEnrollmentSummary;
import com.unifiedtree.attendance.face.dto.FaceDtos.AdminVerificationEvent;
import com.unifiedtree.attendance.face.worker.FaceWorkerClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Face Punch Logs showed "reviewer@unifi…" and "User cbee09fe" (audit, 4 Oct):
 * face rows are keyed by the login, and the admin lists returned only the
 * login's email. Both lists now name the person behind the login, from their
 * employee record, scoped to the event's tenant.
 */
class FaceAdminPeopleTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID LOGIN = UUID.fromString("cbee09fe-76ed-45cc-9465-17329903daaa");
    private static final UUID PERSON = UUID.fromString("11111111-1111-1111-1111-111111111111");

    private JdbcTemplate jdbc;
    private FaceService face;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        face = new FaceService(jdbc, mock(FaceWriter.class), mock(FaceWorkerClient.class), mock(EmbeddingCipher.class),
                mock(ApplicationEventPublisher.class), true, 0.75, 0.07, 0.05, 2, 0.55, true, 0.35, 8, 0, "sface", "sface-1.0");
    }

    /** One row through the service's own row handler. */
    private void rows(ResultSet rs) {
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            h.processRow(rs);
            return null;
        }).when(jdbc).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));
    }

    private static ResultSet person(ResultSet rs, String first, String last) throws Exception {
        when(rs.getString("first_name")).thenReturn(first);
        when(rs.getString("last_name")).thenReturn(last);
        when(rs.getString("employee_code")).thenReturn("ADM001");
        when(rs.getString("hr_employee_id")).thenReturn(PERSON.toString());
        return rs;
    }

    @Test
    void theEventsNameThePersonBehindTheLogin() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getString("id")).thenReturn(UUID.randomUUID().toString());
        when(rs.getString("employee_id")).thenReturn(LOGIN.toString());
        when(rs.getString("purpose")).thenReturn("PUNCH_IN");
        when(rs.getString("result")).thenReturn("PASS");
        when(rs.getTimestamp("created_at")).thenReturn(Timestamp.from(Instant.parse("2026-10-01T03:30:00Z")));
        rows(person(rs, "Google", "Reviewer"));

        List<AdminVerificationEvent> events = face.adminEvents(TENANT, null, 500);

        assertThat(events).hasSize(1);
        AdminVerificationEvent e = events.get(0);
        assertThat(e.employeeId()).isEqualTo(LOGIN);
        assertThat(e.employeeName()).isEqualTo("Google Reviewer");
        assertThat(e.employeeCode()).isEqualTo("ADM001");
        assertThat(e.hrEmployeeId()).isEqualTo(PERSON);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(RowCallbackHandler.class), any(Object[].class));
        assertThat(sql.getValue()).contains(FaceService.PERSON_JOIN).contains(FaceService.PERSON_COLUMNS)
                .contains("per.tenant_id = fe.tenant_id").contains("who.tenant_id = fe.tenant_id")
                .doesNotContain("%s");
    }

    @Test
    void theEnrolmentsNameThePersonTooAndALoginWithoutARecordStaysNameless() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getString("employee_id")).thenReturn(LOGIN.toString());
        when(rs.getString("email")).thenReturn("reviewer@unifiedtree.com");
        when(rs.getString("status")).thenReturn("ACTIVE");
        rows(person(rs, "null", null));

        List<AdminEnrollmentSummary> list = face.adminList(TENANT, null);

        assertThat(list).hasSize(1);
        // "null" text from an old import is not a name.
        assertThat(list.get(0).employeeName()).isNull();
        assertThat(list.get(0).email()).isEqualTo("reviewer@unifiedtree.com");
        assertThat(list.get(0).hrEmployeeId()).isEqualTo(PERSON);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(RowCallbackHandler.class), any(Object[].class));
        assertThat(sql.getValue()).contains(FaceService.PERSON_JOIN).doesNotContain("%s");
    }

    @Test
    void aNameIsBuiltFromTheRealParts() {
        assertThat(FaceService.personName("Asha", "Rao")).isEqualTo("Asha Rao");
        assertThat(FaceService.personName(" Asha ", "null")).isEqualTo("Asha");
        assertThat(FaceService.personName(null, "Rao")).isEqualTo("Rao");
        assertThat(FaceService.personName("  ", "undefined")).isNull();
        assertThat(FaceService.personName(null, null)).isNull();
    }
}
