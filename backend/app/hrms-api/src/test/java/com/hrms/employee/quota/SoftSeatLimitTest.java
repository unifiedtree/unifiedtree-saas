package com.hrms.employee.quota;

import com.hrms.api.quota.SeatQuotaController;
import com.hrms.core.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Soft seat limit (owner decision, 6 Oct 2026): over the bought seats is allowed and billed at the cycle end. */
class SoftSeatLimitTest {

    private final UUID tenant = UUID.randomUUID();

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    @Test
    void addingEmployeesOverTheBoughtSeatsIsAllowed() {
        SeatQuotaService seats = mock(SeatQuotaService.class);
        when(seats.getUsage(tenant)).thenReturn(new SeatQuotaService.Usage(10, 10, 0));
        TenantContext.setTenantId(tenant);
        SeatQuotaEnforcer enforcer = new SeatQuotaEnforcer(seats, mock(JdbcTemplate.class));

        assertDoesNotThrow(() -> enforcer.assertCapacity(1));
        assertDoesNotThrow(() -> enforcer.assertCapacity(25));   // a bulk import well past the cap
    }

    @Test
    void aWorkspaceWithNoBoughtSeatsCanStillAddPeople() {
        SeatQuotaService seats = mock(SeatQuotaService.class);
        when(seats.getUsage(tenant)).thenReturn(new SeatQuotaService.Usage(0, 3, 0));
        TenantContext.setTenantId(tenant);

        assertDoesNotThrow(() -> new SeatQuotaEnforcer(seats, mock(JdbcTemplate.class)).assertCapacity(1));
    }

    @Test
    void aBrokenSeatCountStillRefuses() {
        SeatQuotaService seats = mock(SeatQuotaService.class);
        when(seats.getUsage(tenant)).thenThrow(new QueryTimeoutException("db down"));
        TenantContext.setTenantId(tenant);

        SeatLimitExceededException e = assertThrows(SeatLimitExceededException.class,
                () -> new SeatQuotaEnforcer(seats, mock(JdbcTemplate.class)).assertCapacity(1));
        assertEquals(SeatLimitExceededException.CODE_QUOTA_LOOKUP_FAILED, e.getErrorCode());
    }

    @Test
    void usageKeepsTheOldFieldsAndSaysHowManyAreOver() {
        SeatQuotaService seats = mock(SeatQuotaService.class);
        when(seats.getUsageForCurrentTenant()).thenReturn(new SeatQuotaService.Usage(10, 12, 0));
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(org.springframework.jdbc.core.RowMapper.class), eq(tenant)))
                .thenReturn(java.util.List.of(java.sql.Timestamp.from(java.time.Instant.parse("2026-11-05T18:30:00Z"))));
        TenantContext.setTenantId(tenant);

        SeatQuotaController.SeatUsage u = new SeatQuotaController(seats, jdbc).usage();

        assertEquals(10, u.purchased());
        assertEquals(12, u.current());
        assertEquals(12, u.currentExcludingAdmin());
        assertEquals(0, u.remaining());
        assertEquals(10, u.seatsBought());
        assertEquals(12, u.seatsUsed());
        assertEquals(2, u.overBy());
        assertTrue(u.extraBilledAtCycleEnd());
        assertEquals(java.time.LocalDate.of(2026, 11, 6), u.cycleEndsOn());   // IST day of the period end
    }

    @Test
    void withinTheSeatsNothingIsOverAndNoPaidCycleMeansNoDate() {
        SeatQuotaService seats = mock(SeatQuotaService.class);
        when(seats.getUsageForCurrentTenant()).thenReturn(new SeatQuotaService.Usage(10, 7, 3));
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(org.springframework.jdbc.core.RowMapper.class), eq(tenant)))
                .thenReturn(java.util.List.of());
        TenantContext.setTenantId(tenant);

        SeatQuotaController.SeatUsage u = new SeatQuotaController(seats, jdbc).usage();

        assertEquals(0, u.overBy());
        assertNull(u.cycleEndsOn());
    }
}
