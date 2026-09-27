package com.hrms.api.workforce;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** BW-92: drafts are stripped before saving, personal to their author, and answer FEATURE_NOT_READY without the table. */
class EmployeeDraftServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final UUID company = UUID.randomUUID();
    private final UUID draftId = UUID.randomUUID();
    private final ObjectMapper json = new ObjectMapper();
    private JdbcTemplate jdbc;
    private EmployeeDraftService service;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        jdbc = mock(JdbcTemplate.class);
        service = new EmployeeDraftService(jdbc, json);
        when(jdbc.queryForObject(startsWith("SELECT EXISTS"), eq(Boolean.class), any(), any())).thenReturn(true);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private static BadSqlGrammarException missingTable() {
        return new BadSqlGrammarException("draft", "SELECT … FROM hrms.employee_drafts",
                new SQLException("relation \"hrms.employee_drafts\" does not exist", "42P01"));
    }

    private EmployeeDraftService.SaveRequest request(String payload) throws Exception {
        return new EmployeeDraftService.SaveRequest(company, json.readTree(payload));
    }

    @SuppressWarnings("unchecked")
    private void draftFound() {
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any())).thenReturn(List.of(
                new EmployeeDraftService.Draft(draftId, company, "Asha Rao", json.createObjectNode(), Instant.now(), Instant.now(), List.of())));
    }

    @Test
    void createSavesTheFormWithoutIdentityOrBankDetails() throws Exception {
        when(jdbc.queryForObject(startsWith("INSERT INTO hrms.employee_drafts"), eq(UUID.class), any(), any(), any(), any())).thenReturn(draftId);
        draftFound();
        service.create(user, request("""
                {"firstName":"Asha","lastName":"Rao","panNumber":"ABCDE1234F","aadhaarNumber":"123412341234",
                 "bankAccountNumber":"123456789012","bankIfsc":"HDFC0001234","monthlySalary":50000}
                """));
        ArgumentCaptor<Object> text = ArgumentCaptor.forClass(Object.class);
        verify(jdbc).queryForObject(startsWith("INSERT INTO hrms.employee_drafts"), eq(UUID.class),
                eq(tenant), eq(company), eq(user), text.capture());
        ObjectNode saved = (ObjectNode) json.readTree((String) text.getValue());
        assertThat(saved.fieldNames()).toIterable().containsExactlyInAnyOrder("firstName", "lastName", "monthlySalary");
        assertThat((String) text.getValue()).doesNotContain("ABCDE1234F", "123412341234", "123456789012", "HDFC0001234");
    }

    @Test
    void theResponseSaysWhatWasRemoved() throws Exception {
        when(jdbc.queryForObject(startsWith("INSERT INTO hrms.employee_drafts"), eq(UUID.class), any(), any(), any(), any())).thenReturn(draftId);
        // find() maps the row with the stripped list: run the real row mapper over a fake row.
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any())).thenAnswer(inv -> {
            RowMapper<?> mapper = inv.getArgument(1);
            java.sql.ResultSet rs = mock(java.sql.ResultSet.class);
            when(rs.getObject("id", UUID.class)).thenReturn(draftId);
            when(rs.getObject("company_id", UUID.class)).thenReturn(company);
            when(rs.getString("payload")).thenReturn("{\"firstName\":\"Asha\"}");
            when(rs.getTimestamp("created_at")).thenReturn(java.sql.Timestamp.from(Instant.now()));
            when(rs.getTimestamp("updated_at")).thenReturn(java.sql.Timestamp.from(Instant.now()));
            return List.of(mapper.mapRow(rs, 0));
        });
        EmployeeDraftService.Draft d = service.create(user, request("{\"firstName\":\"Asha\",\"pan\":\"ABCDE1234F\",\"ifsc\":\"HDFC0001234\"}"));
        assertThat(d.strippedFields()).containsExactlyInAnyOrder("pan", "ifsc");
        assertThat(d.displayName()).isEqualTo("Asha");
        assertThat(d.payload().has("pan")).isFalse();
    }

    @Test
    void everyStatementIsLimitedToTheAuthorAndTheTenant() {
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any(), any())).thenReturn(List.of());
        service.list(user, null);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(RowMapper.class), eq(tenant), eq(user), any(), any());
        assertThat(sql.getValue()).contains("tenant_id = ?", "created_by_user_id = ?");
    }

    @Test
    void someoneElsesDraftIsNotFound() throws Exception {
        when(jdbc.update(startsWith("UPDATE hrms.employee_drafts"), any(), any(), any(), any(), any())).thenReturn(0);
        assertThatThrownBy(() -> service.update(user, draftId, request("{\"firstName\":\"Asha\"}")))
                .isInstanceOf(ResourceNotFoundException.class);
        when(jdbc.update(startsWith("DELETE FROM hrms.employee_drafts"), any(), any(), any())).thenReturn(0);
        assertThatThrownBy(() -> service.delete(user, draftId)).isInstanceOf(ResourceNotFoundException.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any())).thenReturn(List.of());
        assertThatThrownBy(() -> service.get(user, draftId)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void refusesAnEmptyOrNonObjectPayloadAnUnknownCompanyAndAnOversizedForm() throws Exception {
        assertThatThrownBy(() -> service.create(user, new EmployeeDraftService.SaveRequest(company, null)))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("errorCode", "DRAFT_PAYLOAD_REQUIRED");
        assertThatThrownBy(() -> service.create(user, request("[1,2]")))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("errorCode", "DRAFT_PAYLOAD_INVALID");
        assertThatThrownBy(() -> service.create(user, new EmployeeDraftService.SaveRequest(null, json.readTree("{}"))))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("errorCode", "DRAFT_COMPANY_REQUIRED");
        UUID other = UUID.randomUUID();
        when(jdbc.queryForObject(startsWith("SELECT EXISTS"), eq(Boolean.class), any(), eq(other))).thenReturn(false);
        assertThatThrownBy(() -> service.create(user, new EmployeeDraftService.SaveRequest(other, json.readTree("{}"))))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("errorCode", "DRAFT_COMPANY_UNKNOWN");
        String big = "{\"notes\":\"" + "x".repeat(EmployeeDraftPayload.MAX_CHARS) + "\"}";
        assertThatThrownBy(() -> service.create(user, request(big)))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("errorCode", "DRAFT_TOO_LARGE");
        verify(jdbc, never()).queryForObject(startsWith("INSERT"), eq(UUID.class), any(), any(), any(), any());
    }

    @Test
    void missingTableAnswersFeatureNotReady() throws Exception {
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any(), any())).thenThrow(missingTable());
        assertThatThrownBy(() -> service.list(user, company))
                .isInstanceOf(FeatureNotReady.class)
                .hasFieldOrPropertyWithValue("errorCode", "FEATURE_NOT_READY")
                .hasFieldOrPropertyWithValue("status", HttpStatus.SERVICE_UNAVAILABLE);
        when(jdbc.queryForObject(startsWith("INSERT INTO hrms.employee_drafts"), eq(UUID.class), any(), any(), any(), any())).thenThrow(missingTable());
        assertThatThrownBy(() -> service.create(user, request("{\"firstName\":\"Asha\"}"))).isInstanceOf(FeatureNotReady.class);
        when(jdbc.update(startsWith("DELETE FROM hrms.employee_drafts"), any(), any(), any())).thenThrow(missingTable());
        assertThatThrownBy(() -> service.delete(user, draftId)).isInstanceOf(FeatureNotReady.class);
    }
}
