package com.hrms.employee.quota;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.BadSqlGrammarException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SeatQuotaCompatibilityTest {
    @Test void trialWithoutPurchasedOrLegacyCapStillCountsUsedSeats() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID tenant = UUID.randomUUID();
        when(jdbc.queryForObject(contains("platform.subscriptions"), eq(Integer.class), eq(tenant))).thenReturn(null);
        when(jdbc.queryForObject(contains("platform.tenant_modules"), eq(Integer.class), eq(tenant))).thenReturn(null);
        when(jdbc.queryForObject(contains("plan_type"), eq(String.class), eq(tenant))).thenReturn("TRIAL");
        when(jdbc.queryForObject(contains("count(*)"), eq(Integer.class), eq(tenant))).thenReturn(4);
        var usage = new SeatQuotaService(jdbc, mock(ApplicationEventPublisher.class)).getUsage(tenant);
        assertEquals(5, usage.purchased());
        assertEquals(4, usage.current());
        assertEquals(1, usage.remaining());
    }

    @Test void brokenQuotaQueryPropagatesInsteadOfTryingFallbackInsideAbortedTransaction() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID tenant = UUID.randomUUID();
        var failure = new BadSqlGrammarException("query", "sql", new java.sql.SQLException("schema drift"));
        when(jdbc.queryForObject(contains("platform.subscriptions"), eq(Integer.class), eq(tenant))).thenThrow(failure);
        assertThrows(BadSqlGrammarException.class, () -> new SeatQuotaService(jdbc, mock(ApplicationEventPublisher.class)).getUsage(tenant));
        verify(jdbc, never()).queryForObject(contains("platform.tenant_modules"), eq(Integer.class), eq(tenant));
    }
}
