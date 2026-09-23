package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DisbursementBatchSafetyTest {
    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID(), run = UUID.randomUUID();
    private final UUID profile = UUID.randomUUID(), batchId = UUID.randomUUID(), actor = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final DisbursementBatchService service = new DisbursementBatchService(jdbc);

    @AfterEach void clearTenant() {
        com.unifiedtree.security.tenant.TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    @Test void anotherBankCannotBuildASecondCopyOfTheSameSalaries() throws Exception {
        buildInputs();
        extractor("SELECT id, status, bank_profile_id", run, Map.of(
                "id", batchId, "status", "DRAFT", "bank_profile_id", UUID.randomUUID()));

        BusinessRuleException error = assertThrows(BusinessRuleException.class,
                () -> service.buildFromRun(tenant, new DisbursementBatchService.BuildBatchRequest(run, profile), actor));

        assertEquals("BATCH_ALREADY_EXISTS", error.getErrorCode());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verify(jdbc, never()).queryForObject(contains("INSERT INTO payroll.disbursement_batches"), eq(UUID.class), any(Object[].class));
    }

    @Test void theSameBankMayRebuildItsExistingDraftWithoutCreatingAnotherBatch() throws Exception {
        buildInputs();
        extractor("SELECT id, status, bank_profile_id", run, Map.of(
                "id", batchId, "status", "DRAFT", "bank_profile_id", profile));
        batchRows(batch("DRAFT"));

        var result = service.buildFromRun(tenant, new DisbursementBatchService.BuildBatchRequest(run, profile), actor);

        assertEquals(batchId, result.batch().id());
        verify(jdbc).update("DELETE FROM payroll.disbursement_batch_lines WHERE batch_id = ?", batchId);
        verify(jdbc, never()).queryForObject(contains("INSERT INTO payroll.disbursement_batches"), eq(UUID.class), any(Object[].class));
    }

    @Test void aPostedBatchCannotRecordPaymentAgainForAnAlreadyPaidRun() throws Exception {
        batchRows(batch("POSTED"));
        extractor("SELECT status FROM payroll.runs", run, Map.of("status", "PAID"));

        BusinessRuleException error = assertThrows(BusinessRuleException.class,
                () -> service.markPaid(tenant, batchId, new DisbursementBatchService.MarkPaidRequest("QA-UTR", null), actor));

        assertEquals("RUN_NOT_LOCKED", error.getErrorCode());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void cancellationWhileWaitingForTheRunLockIsRecheckedBeforePayment() throws Exception {
        when(jdbc.query(eq("SELECT * FROM payroll.disbursement_batches WHERE id = ?"),
                org.mockito.ArgumentMatchers.<RowMapper<DisbursementBatchService.BatchDto>>any(), eq(batchId)))
                .thenReturn(List.of(batch("POSTED")), List.of(batch("CANCELLED")));
        extractor("SELECT status FROM payroll.runs", run, Map.of("status", "LOCKED"));

        BusinessRuleException error = assertThrows(BusinessRuleException.class,
                () -> service.markPaid(tenant, batchId, new DisbursementBatchService.MarkPaidRequest("QA-UTR", null), actor));

        assertEquals("BATCH_NOT_POSTED", error.getErrorCode());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void aPostedBatchOnALockedRunCanBeRecordedPaid() throws Exception {
        batchRows(batch("POSTED"));
        extractor("SELECT status FROM payroll.runs", run, Map.of("status", "LOCKED"));
        when(jdbc.update(contains("UPDATE payroll.runs"), eq(run))).thenReturn(1);

        service.markPaid(tenant, batchId, new DisbursementBatchService.MarkPaidRequest("QA-UTR", null), actor);

        verify(jdbc).update(contains("UPDATE payroll.runs"), eq(run));
        verify(jdbc).update(contains("UPDATE payroll.disbursement_batches"), eq("QA-UTR"), isNull(), eq(actor.toString()), eq(batchId));
    }

    @Test void aDraftWithExcludedEmployeesCannotBePosted() throws Exception {
        batchRows(batch("DRAFT"));
        extractor("SELECT status FROM payroll.runs", run, Map.of("status", "LOCKED"));
        when(jdbc.queryForObject(contains("status <> 'READY'"), eq(Integer.class), eq(batchId))).thenReturn(1);
        BusinessRuleException error = assertThrows(BusinessRuleException.class, () -> service.post(tenant, batchId, actor));
        assertEquals("BATCH_HAS_EXCLUDED_EMPLOYEES", error.getErrorCode());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void aLegacyPostedBatchWithExclusionsCannotMarkTheEntireRunPaid() throws Exception {
        batchRows(batch("POSTED"));
        extractor("SELECT status FROM payroll.runs", run, Map.of("status", "LOCKED"));
        when(jdbc.queryForObject(contains("status <> 'READY'"), eq(Integer.class), eq(batchId))).thenReturn(1);
        BusinessRuleException error = assertThrows(BusinessRuleException.class,
                () -> service.markPaid(tenant, batchId, new DisbursementBatchService.MarkPaidRequest("QA-UTR", null), actor));
        assertEquals("BATCH_HAS_EXCLUDED_EMPLOYEES", error.getErrorCode());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    private void buildInputs() throws Exception {
        extractor("SELECT id, company_id, status, total_net", run, Map.of(
                "id", run, "company_id", company, "status", "LOCKED", "total_net", BigDecimal.TEN,
                "period_month", 9, "period_year", 2026));
        extractor("SELECT id, company_id, bank_format", profile, Map.of(
                "id", profile, "company_id", company, "bank_format", "GENERIC_CSV", "is_active", true));
    }

    private DisbursementBatchService.BatchDto batch(String status) {
        return new DisbursementBatchService.BatchDto(batchId, company, run, profile, "QA-BATCH",
                BigDecimal.TEN, 1, status, null, null, null, null, null, null, null);
    }

    private void batchRows(DisbursementBatchService.BatchDto value) {
        when(jdbc.query(eq("SELECT * FROM payroll.disbursement_batches WHERE id = ?"),
                org.mockito.ArgumentMatchers.<RowMapper<DisbursementBatchService.BatchDto>>any(), eq(batchId)))
                .thenReturn(List.of(value));
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private void extractor(String sqlFragment, UUID parameter, Map<String, Object> row) throws Exception {
        when(jdbc.query(contains(sqlFragment), any(ResultSetExtractor.class), eq(parameter)))
                .thenAnswer(call -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.next()).thenReturn(true, false);
                    when(rs.getObject(anyString(), eq(UUID.class))).thenAnswer(c -> row.get(c.getArgument(0)));
                    when(rs.getString(anyString())).thenAnswer(c -> (String) row.get(c.getArgument(0)));
                    when(rs.getBigDecimal(anyString())).thenAnswer(c -> (BigDecimal) row.get(c.getArgument(0)));
                    when(rs.getInt(anyString())).thenAnswer(c -> (Integer) row.get(c.getArgument(0)));
                    when(rs.getBoolean(anyString())).thenAnswer(c -> (Boolean) row.get(c.getArgument(0)));
                    return ((ResultSetExtractor) call.getArgument(1)).extractData(rs);
                });
    }
}
