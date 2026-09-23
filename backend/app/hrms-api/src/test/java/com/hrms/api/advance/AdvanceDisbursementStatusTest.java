package com.hrms.api.advance;

import com.hrms.advance.entity.AdvanceRequest;
import com.hrms.advance.enums.AdvanceStatus;
import com.hrms.advance.repository.AdvanceRequestRepository;
import com.hrms.advance.service.AdvanceService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AdvanceDisbursementStatusTest {
    private final UUID tenant = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID id = UUID.randomUUID();
    private final AdvanceRequestRepository repository = mock(AdvanceRequestRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AdvanceService service = new AdvanceService(repository, jdbc);
    private AdvanceRequest advance;

    @BeforeEach void approvedAdvance() {
        TenantContext.setTenantId(tenant);
        advance = new AdvanceRequest();
        advance.setId(id);
        advance.setTenantId(tenant);
        advance.setEmployeeId(employee);
        advance.setStatus(AdvanceStatus.APPROVED);
        advance.setAmount(new BigDecimal("1000.00"));
        advance.setOutstandingAmount(new BigDecimal("1000.00"));
        when(repository.findById(id)).thenReturn(Optional.of(advance));
        when(repository.saveAndFlush(advance)).thenReturn(advance);
        when(jdbc.queryForObject(contains("FROM advance_mgmt.advance_requests"), eq(String.class), eq(tenant), eq(id)))
                .thenReturn("APPROVED");
    }

    @AfterEach void clearTenant() { TenantContext.clear(); }

    @Test void advanceApprovedBeforeSeparationCannotCreateNewDebtAfterwards() {
        for (String status : new String[]{"EXITED", "TERMINATED"}) {
            when(jdbc.queryForObject(contains("FROM hrms.employees"), eq(String.class), eq(tenant), eq(employee)))
                    .thenReturn(status);
            BusinessRuleException error = assertThrows(BusinessRuleException.class, () -> service.disburse(id));
            assertTrue(error.getMessage().contains("exited or been terminated"));
            assertEquals(AdvanceStatus.APPROVED, advance.getStatus());
            assertNull(advance.getDisbursedAt());
            assertEquals(new BigDecimal("1000.00"), advance.getOutstandingAmount());
        }
        verify(repository, never()).saveAndFlush(any());
        verify(jdbc, never()).queryForObject(contains("FROM advance_mgmt.advance_requests"), eq(String.class), any(), any());
    }

    @Test void activeEmployeeDisbursementLocksEmployeeBeforeAdvanceAndFlushes() {
        when(jdbc.queryForObject(contains("FROM hrms.employees"), eq(String.class), eq(tenant), eq(employee)))
                .thenReturn("ACTIVE");
        assertEquals(AdvanceStatus.DISBURSED, service.disburse(id).status());
        assertNotNull(advance.getDisbursedAt());
        var order = inOrder(jdbc, repository);
        order.verify(repository).findById(id);
        order.verify(jdbc).queryForObject(contains("FROM hrms.employees"), eq(String.class), eq(tenant), eq(employee));
        order.verify(jdbc).queryForObject(contains("FROM advance_mgmt.advance_requests"), eq(String.class), eq(tenant), eq(id));
        order.verify(repository).saveAndFlush(advance);
    }

    @Test void alreadyDisbursedDatabaseStateOverridesStaleApprovedEntity() {
        when(jdbc.queryForObject(contains("FROM hrms.employees"), eq(String.class), eq(tenant), eq(employee)))
                .thenReturn("ACTIVE");
        when(jdbc.queryForObject(contains("FROM advance_mgmt.advance_requests"), eq(String.class), eq(tenant), eq(id)))
                .thenReturn("DISBURSED");
        assertThrows(BusinessRuleException.class, () -> service.disburse(id));
        verify(repository, never()).saveAndFlush(any());
    }
}
