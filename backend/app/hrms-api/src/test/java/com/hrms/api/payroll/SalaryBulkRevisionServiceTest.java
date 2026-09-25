package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.notifications.events.SalaryStructureRevisedEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Apply only writes what the preview showed, in one go, and tells each person.
 * (The maths is covered by {@link SalaryRevisionPlannerTest}.)
 */
class SalaryBulkRevisionServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID emp1 = UUID.randomUUID(), emp2 = UUID.randomUUID(), noStructure = UUID.randomUUID();
    private final UUID s1 = UUID.randomUUID(), s2 = UUID.randomUUID();
    private final UUID batch = UUID.randomUUID(), newStructure = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final SalaryBulkRevisionService service = new SalaryBulkRevisionService(jdbc, events);
    private final String nextMonth = LocalDate.now(ZoneId.of("Asia/Kolkata")).withDayOfMonth(1).plusMonths(1).toString();

    private Map<String, Object> row(UUID id, String code, UUID structure, String ctc) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", id); m.put("employee_code", code); m.put("name", "Person " + code);
        m.put("company_id", UUID.randomUUID()); m.put("company_name", "Acme");
        m.put("department_id", null); m.put("department_name", "Finance");
        m.put("designation_id", null); m.put("designation", null); m.put("grade", null);
        m.put("structure_id", structure);
        m.put("ctc_annual", ctc == null ? null : new BigDecimal(ctc));
        m.put("ctc_monthly", ctc == null ? null : new BigDecimal(ctc).divide(new BigDecimal("12"), 2, java.math.RoundingMode.HALF_UP));
        m.put("effective_from", structure == null ? null : java.sql.Date.valueOf("2026-04-01"));
        return m;
    }

    @BeforeEach void data() {
        when(jdbc.queryForList(contains("FROM hrms.employees e"), any(Object[].class)))
                .thenReturn(List.of(row(emp1, "E1", s1, "600000.00"), row(emp2, "E2", s2, "300000.00"), row(noStructure, "E3", null, null)));
        // No configured lines: both are paid as BASIC = CTC / 12 and stay that way.
        doNothing().when(jdbc).query(contains("employee_structure_components"), any(RowCallbackHandler.class), any(Object[].class));
        when(jdbc.query(contains("FROM payroll.runs"), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        when(jdbc.queryForObject(contains("INSERT INTO payroll.salary_revision_batches"), eq(UUID.class), any(Object[].class))).thenReturn(batch);
        when(jdbc.queryForObject(contains("INSERT INTO payroll.employee_salary_structures"), eq(UUID.class), any(Object[].class))).thenReturn(newStructure);
        when(jdbc.update(contains("SET is_current = NULL"), any(Object[].class))).thenReturn(1);
    }

    @AfterEach void clear() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private SalaryBulkRevisionService.BulkReviseRequest req(String key) {
        return new SalaryBulkRevisionService.BulkReviseRequest(null, null, null, null, null,
                "PERCENT", new BigDecimal("10"), nextMonth, "Annual increment", key);
    }

    @Test void previewListsOldNewAndDifferenceAndWhoIsSkipped() {
        var p = service.preview(tenant, req(null));
        assertEquals(2, p.employees());
        assertEquals(new BigDecimal("660000.00"), p.rows().get(0).newCtc());
        assertEquals(new BigDecimal("60000.00"), p.rows().get(0).difference());
        assertEquals(new BigDecimal("90000.00"), p.totalDifference());
        assertEquals("+10%", p.change());
        assertEquals(1, p.skipped().size());
        assertEquals("NO_STRUCTURE", p.skipped().get(0).reason());
        assertTrue(p.blockers().isEmpty());
        assertNotNull(p.previewKey());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void applyNeedsThePreviewItShowed() {
        assertThrows(BusinessRuleException.class, () -> service.apply(tenant, req(null), null, null));
        BusinessRuleException stale = assertThrows(BusinessRuleException.class, () -> service.apply(tenant, req("not-the-preview"), null, null));
        assertEquals("REVISION_PREVIEW_OUT_OF_DATE", stale.getErrorCode());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verify(jdbc, never()).queryForObject(contains("INSERT"), eq(UUID.class), any(Object[].class));
        verifyNoInteractions(events);
    }

    @Test void applyWritesABatchANewStructurePerPersonAndNotifiesEachOne() {
        String key = service.preview(tenant, req(null)).previewKey();
        var result = service.apply(tenant, req(key), UUID.randomUUID(), UUID.randomUUID());
        assertEquals(batch, result.batchId());
        assertEquals(2, result.applied());
        verify(jdbc, times(1)).queryForObject(contains("INSERT INTO payroll.salary_revision_batches"), eq(UUID.class), any(Object[].class));
        verify(jdbc, times(2)).update(contains("SET is_current = NULL"), any(Object[].class));
        verify(jdbc, times(2)).queryForObject(contains("INSERT INTO payroll.employee_salary_structures"), eq(UUID.class), any(Object[].class));
        verify(events, times(2)).publishEvent(any(SalaryStructureRevisedEvent.class));
    }

    @Test void applyStopsIfSomeoneSavedAStructureMeanwhile() {
        String key = service.preview(tenant, req(null)).previewKey();
        when(jdbc.update(contains("SET is_current = NULL"), any(Object[].class))).thenReturn(0);
        BusinessRuleException ex = assertThrows(BusinessRuleException.class, () -> service.apply(tenant, req(key), null, null));
        assertEquals("REVISION_PREVIEW_OUT_OF_DATE", ex.getErrorCode());
        verifyNoInteractions(events);
    }

    @Test void anOpenEarlierPayrollRunBlocksApply() {
        when(jdbc.query(contains("FROM payroll.runs"), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(
                new SalaryRevisionPlanner.RunInfo(UUID.randomUUID(), "Acme", 2020, 1, LocalDate.of(2020, 1, 1), LocalDate.of(2020, 1, 31), "DRAFT")));
        var p = service.preview(tenant, req(null));
        assertEquals(1, p.blockers().size());
        BusinessRuleException ex = assertThrows(BusinessRuleException.class, () -> service.apply(tenant, req(p.previewKey()), null, null));
        assertEquals("REVISION_BLOCKED_BY_PAYROLL", ex.getErrorCode());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void exportCsvIsSpreadsheetSafe() {
        var x = new SalaryStructureExportService.ExportDto("2026-09-25",
                List.of(new SalaryStructureExportService.ColumnDto("BASIC", "Basic Salary", "EARNING")),
                List.of(new SalaryStructureExportService.ExportRowDto(emp1, "E1", "=HYPERLINK(\"x\")", "Acme, Inc", null, null, null,
                        "NOTICE_PERIOD", "2026-04-01", new BigDecimal("600000.00"), new BigDecimal("50000.00"),
                        new BigDecimal("50000.00"), false, "NEW", true, Map.of("BASIC", new BigDecimal("25000.00")))));
        String csv = SalaryStructureExportService.csv(x);
        String[] lines = csv.split("\r\n");
        assertTrue(lines[0].startsWith("Employee code,Employee name,Company"));
        assertTrue(lines[0].contains("Basic Salary (monthly)"));
        assertTrue(lines[1].contains("\"'=HYPERLINK(\"\"x\"\")\""), lines[1]);
        assertTrue(lines[1].contains("\"Acme, Inc\""));
        assertTrue(lines[1].contains("Notice period"));
        assertTrue(lines[1].contains(",600000,50000,25000,50000,Component split,NEW regime,Yes"), lines[1]);
    }
}
