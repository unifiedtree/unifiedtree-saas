package com.hrms.api.payroll;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Salary structures for the redesign (BW-56): history with reasons, search, page size. */
class SalaryStructureListServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID READER = UUID.randomUUID();

    @Test
    void theReasonIsTheRevisionNoteElseTheBulkRevisionsReason() {
        assertEquals("Promotion", SalaryStructureListService.reason(" Promotion ", "Annual revision"));
        assertEquals("Annual revision", SalaryStructureListService.reason("  ", "Annual revision"));
        assertNull(SalaryStructureListService.reason(null, null));
    }

    @Test
    void aSearchIsTakenLiterally() {
        assertNull(SalaryStructureListService.likePattern(null));
        assertNull(SalaryStructureListService.likePattern("  "));
        assertEquals("%asha%", SalaryStructureListService.likePattern(" Asha "));
        assertEquals("%50\\%\\_off%", SalaryStructureListService.likePattern("50%_off"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void myHistoryIsMineNewestFirstWithTheChangeFromTheOneBefore() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        SalaryStructureListService service = new SalaryStructureListService(jdbc, mock(PayrollService.class));
        UUID now = UUID.randomUUID(), before = UUID.randomUUID();
        doReturn(List.of(
                new Object[]{now, "2026-04-01", null, new BigDecimal("660000"), new BigDecimal("55000"), true, "Annual revision", "NEW"},
                new Object[]{before, "2025-04-01", "2026-03-31", new BigDecimal("600000"), new BigDecimal("50000"), false, null, "OLD"}))
                .when(jdbc).query(contains("FROM payroll.employee_salary_structures s"), any(RowMapper.class), any(Object[].class));

        List<SalaryStructureListService.SalaryHistoryDto> history = service.myHistory(TENANT, READER);

        assertEquals(2, history.size());
        assertEquals(new SalaryStructureListService.SalaryHistoryDto(now, "2026-04-01", null, new BigDecimal("660000"),
                new BigDecimal("55000"), new BigDecimal("10.0"), "Annual revision", true, "NEW"), history.get(0));
        assertNull(history.get(1).changePercent(), "the first structure has nothing to compare with");
        verify(jdbc).query(contains("WHERE s.tenant_id = ? AND s.employee_id = ?"), any(RowMapper.class), eq(TENANT), eq(READER));

        assertEquals(List.of(), service.myHistory(TENANT, null), "no employee record, no history");
    }
}
