package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** The employee's reason for overtime (V143.25): given at check-out, or later while it is pending. */
class OvertimeReasonsTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final OvertimeReasons reasons = new OvertimeReasons(jdbc);
    private final UUID tenant = UUID.randomUUID();
    private final UUID record = UUID.randomUUID();
    private final UUID me = UUID.randomUUID();

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    private void recordRow(UUID owner, int minutes) {
        when(jdbc.queryForList(startsWith("SELECT employee_id, overtime_minutes FROM attendance.records"), eq(record), eq(tenant)))
                .thenReturn(List.of(Map.of("employee_id", owner, "overtime_minutes", minutes)));
    }

    private void decided(int count) {
        when(jdbc.queryForObject(startsWith("SELECT count(*) FROM attendance.overtime_decisions"), eq(Integer.class), eq(tenant), eq(record), anyInt()))
                .thenReturn(count);
    }

    @Test void textIsTidiedBeforeItIsStored() {
        assertEquals("Month-end closing with finance", OvertimeReasons.normalize("  Month-end\nclosing \t with finance "));
        assertNull(OvertimeReasons.normalize("   "));
        assertNull(OvertimeReasons.normalize(null));
        assertEquals(500, OvertimeReasons.forCheckout("z".repeat(800)).length());
    }

    @Test void aReasonSentWithTheCheckOutIsStoredOnThatRecord() {
        reasons.recordAtCheckout(record, me, " Server migration ");
        verify(jdbc).update(startsWith("UPDATE attendance.records SET overtime_reason"), eq("Server migration"), eq(record), eq(me), eq(tenant));
    }

    @Test void aBlankReasonAtCheckOutWritesNothing() {
        reasons.recordAtCheckout(record, me, "  ");
        reasons.recordAtCheckout(record, me, null);
        verifyNoInteractions(jdbc);
    }

    @Test void aFailureStoringTheCheckOutReasonNeverFailsThePunch() {
        when(jdbc.update(anyString(), any(), any(), any(), any())).thenThrow(new RuntimeException("db down"));
        assertDoesNotThrow(() -> reasons.recordAtCheckout(record, me, "Audit"));
    }

    @Test void theEmployeeExplainsTheirOwnPendingOvertime() {
        recordRow(me, 90);
        decided(0);
        Map<String, Object> out = reasons.setByEmployee(record, me, "Quarter-end audit");
        assertEquals("Quarter-end audit", out.get("reason"));
        verify(jdbc).update(startsWith("UPDATE attendance.records SET overtime_reason"), eq("Quarter-end audit"), eq(record), eq(tenant));
    }

    @Test void nobodyCanExplainSomeoneElsesOvertime() {
        recordRow(UUID.randomUUID(), 90);
        assertThrows(AccessDeniedException.class, () -> reasons.setByEmployee(record, me, "Quarter-end audit"));
        verify(jdbc, never()).update(startsWith("UPDATE"), eq("Quarter-end audit"), eq(record), eq(tenant));
    }

    @Test void aDecidedOvertimeKeepsTheReasonTheApproverSaw() {
        recordRow(me, 90);
        decided(1);
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> reasons.setByEmployee(record, me, "Changed my mind"));
        assertEquals("OVERTIME_ALREADY_REVIEWED", e.getErrorCode());
    }

    @Test void aMissingRecordIsNotFound() {
        when(jdbc.queryForList(anyString(), eq(record), eq(tenant))).thenReturn(List.of());
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> reasons.setByEmployee(record, me, "Audit work"));
        assertEquals("OVERTIME_NOT_FOUND", e.getErrorCode());
    }

    @Test void theReasonMustSaySomethingAndFitTheColumn() {
        assertEquals("OVERTIME_REASON_REQUIRED",
                assertThrows(BusinessRuleException.class, () -> reasons.setByEmployee(record, me, " ok ")).getErrorCode());
        assertEquals("OVERTIME_REASON_REQUIRED",
                assertThrows(BusinessRuleException.class, () -> reasons.setByEmployee(record, me, null)).getErrorCode());
        assertEquals("OVERTIME_REASON_TOO_LONG",
                assertThrows(BusinessRuleException.class, () -> reasons.setByEmployee(record, me, "x".repeat(501))).getErrorCode());
        verifyNoInteractions(jdbc);
    }
}
