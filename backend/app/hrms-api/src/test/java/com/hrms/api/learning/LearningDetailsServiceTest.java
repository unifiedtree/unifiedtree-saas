package com.hrms.api.learning;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** BW-85: certification states, filters, the place of a program, and tenant filters on every read. */
class LearningDetailsServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final LearningDetailsService service = new LearningDetailsService(jdbc);

    @Test void certificationStatesByExpiry() {
        LocalDate today = LocalDate.of(2026, 10, 2);
        assertEquals("CERTIFIED", LearningDetailsService.certificationStatus(null, today));
        assertEquals("EXPIRED", LearningDetailsService.certificationStatus(today.minusDays(1), today));
        assertEquals("EXPIRING", LearningDetailsService.certificationStatus(today, today));
        assertEquals("EXPIRING", LearningDetailsService.certificationStatus(today.plusDays(60), today));
        assertEquals("CERTIFIED", LearningDetailsService.certificationStatus(today.plusDays(61), today));
    }

    @Test void statusFilterIsOneOfFour() {
        assertEquals("ALL", LearningDetailsService.statusFilter(null));
        assertEquals("EXPIRING", LearningDetailsService.statusFilter("expiring"));
        assertEquals("INVALID_STATUS", assertThrows(BusinessRuleException.class,
                () -> LearningDetailsService.statusFilter("soon")).getErrorCode());
    }

    @Test void locationsAreTrimmedAndLimited() {
        assertNull(LearningDetailsService.cleanLocation("   "));
        assertEquals("Bengaluru office", LearningDetailsService.cleanLocation("  Bengaluru   office "));
        assertEquals("FIELD_TOO_LONG", assertThrows(BusinessRuleException.class,
                () -> LearningDetailsService.cleanLocation("x".repeat(151))).getErrorCode());
    }

    @SuppressWarnings("unchecked")
    @Test void certificationsReadOnlyThisTenantsActivePeople() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
        service.certifications(tenant, "expired", null, 0, 25);
        verify(jdbc).query(argThat((String sql) -> sql.contains("WHERE s.tenant_id = ? AND s.certified = TRUE AND e.is_active = TRUE")
                        && sql.contains("e.tenant_id = s.tenant_id") && sql.contains("d.tenant_id = e.tenant_id")
                        && sql.contains("s.expires_on < ?")),
                any(RowMapper.class), eq(tenant), any(java.sql.Date.class), eq(25), eq(0L));
    }

    @Test void noLocationsAreReadBeforeTheMigration() {
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class))).thenReturn(false);
        assertEquals(java.util.Map.of(), service.locations(tenant, List.of(UUID.randomUUID())));
        verify(jdbc, never()).query(contains("program_locations WHERE"), any(RowCallbackHandler.class), any(Object[].class));
    }

    @Test void aProgramWithAPlaceIsRefusedBeforeTheMigrationAndNothingIsWritten() {
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class))).thenReturn(false);
        LearningService programs = new LearningService(jdbc, service);
        var req = new LearningService.CreateProgramRequest(UUID.randomUUID(), "Manager essentials", null, null, null,
                null, null, null, "IN_PERSON", "Bengaluru office");
        assertThrows(FeatureNotReady.class, () -> programs.createProgram(tenant, req, UUID.randomUUID()));
        verify(jdbc, never()).queryForObject(contains("INSERT INTO learning_mgmt.training_programs"), eq(UUID.class), any(Object[].class));
    }

    @Test void categoriesAreThisTenants() {
        service.categories(tenant);
        verify(jdbc).queryForList(contains("WHERE tenant_id = ?"), eq(String.class), eq(tenant));
    }
}
