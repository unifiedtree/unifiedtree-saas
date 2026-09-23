package com.hrms.api.advance;

import com.hrms.advance.dto.AdvanceResponse;
import com.hrms.advance.enums.AdvanceStatus;
import com.hrms.advance.service.AdvanceService;
import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AdvanceRecoveryTest {
    @Test void closureRequiresTheFullBalanceSoNoDebtLosesItsSchedule() {
        var balance = new BigDecimal("1000.00");
        assertThrows(BusinessRuleException.class, () -> AdvanceRecoveryService.validateFullSettlement(new BigDecimal("999.99"), balance));
        assertThrows(BusinessRuleException.class, () -> AdvanceRecoveryService.validateFullSettlement(new BigDecimal("1000.01"), balance));
        assertDoesNotThrow(() -> AdvanceRecoveryService.validateFullSettlement(new BigDecimal("1000"), balance));
    }

    @Test void roundingNeverLeavesAResidualBalanceOrCreatesExcessRecovery() {
        for (String amount : List.of("1000.00", "100.00", "0.01", "0.03")) {
            for (int months : List.of(3, 6, 60)) {
                var principal = new BigDecimal(amount);
                var monthly = principal.divide(BigDecimal.valueOf(months), 2, java.math.RoundingMode.HALF_UP);
                var remaining = principal;
                var total = BigDecimal.ZERO;
                for (int i = 1; i <= months; i++) {
                    var installment = AdvanceRecoveryService.installmentAmount(remaining, monthly, i == months);
                    assertTrue(installment.signum() >= 0);
                    total = total.add(installment);
                    remaining = remaining.subtract(installment);
                }
                assertEquals(0, principal.compareTo(total));
                assertEquals(0, remaining.signum());
            }
        }
    }

    @Test void unrelatedManagerCannotReadRecoveryOrDeferAnInstallment() {
        var service = mock(AdvanceRecoveryService.class);
        var advances = mock(AdvanceService.class);
        var controller = new AdvanceRecoveryController(service, advances);
        var id = UUID.randomUUID();
        var employee = UUID.randomUUID();
        var approver = UUID.randomUUID();
        when(advances.getRequest(id)).thenReturn(new AdvanceResponse(id, employee, "Employee", "E001", UUID.randomUUID(),
                BigDecimal.TEN, "Reason", 1, BigDecimal.TEN, AdvanceStatus.DISBURSED, approver,
                null, null, null, BigDecimal.TEN, null));
        var jwt = Jwt.withTokenValue("test").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", UUID.randomUUID().toString())
                .claim("permissions", List.of("hrms.advance.read", "hrms.advance.approve")).build();
        assertThrows(AccessDeniedException.class, () -> controller.schedule(id, jwt));
        assertThrows(AccessDeniedException.class, () -> controller.ledger(id, jwt));
        assertThrows(AccessDeniedException.class, () -> controller.summary(id, jwt));
        assertThrows(AccessDeniedException.class, () -> controller.skipMonth(id, new AdvanceRecoveryService.SkipMonthRequest(1, "Deferral"), jwt));
        verifyNoInteractions(service);
    }
}
