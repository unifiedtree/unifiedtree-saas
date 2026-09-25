package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.pli.dto.PliDecisionRequest;
import com.hrms.pli.entity.PliAward;
import com.hrms.pli.enums.PliStatus;
import com.hrms.pli.repository.PliAwardRepository;
import com.hrms.pli.repository.PliTargetRepository;
import com.hrms.pli.service.PliService;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Approved PLI awards are paid through payroll (client decision, 25 Sep 2026).
 * Once a payroll run includes an award, the separate "Pay" action must refuse
 * it, whether the run is still being processed (award APPROVED, reserved) or
 * locked (award PAID) — so an award is never paid twice.
 */
class PliPayrollNoDoublePayTest {

    private final PliAwardRepository awards = Mockito.mock(PliAwardRepository.class);
    private final PliService service = new PliService(awards, Mockito.mock(PliTargetRepository.class));

    private PliAward award(PliStatus status, UUID runId) {
        PliAward a = new PliAward();
        a.setId(UUID.randomUUID());
        a.setEmployeeId(UUID.randomUUID());
        a.setCompanyId(UUID.randomUUID());
        a.setPlanName("Q3 sales");
        a.setAmount(new BigDecimal("5000"));
        a.setStatus(status);
        a.setPayrollRunId(runId);
        when(awards.findById(a.getId())).thenReturn(Optional.of(a));
        when(awards.save(any(PliAward.class))).thenAnswer(inv -> inv.getArgument(0));
        return a;
    }

    @Test
    void anAwardReservedByAProcessedRunCannotBePaidSeparately() {
        PliAward a = award(PliStatus.APPROVED, UUID.randomUUID());
        assertThatThrownBy(() -> service.pay(a.getId()))
                .isInstanceOf(BusinessRuleException.class)
                .satisfies(e -> assertThat(((BusinessRuleException) e).getErrorCode()).isEqualTo("PLI_IN_PAYROLL"));
        assertThat(a.getStatus()).isEqualTo(PliStatus.APPROVED);
        verify(awards, never()).save(any());
    }

    @Test
    void anAwardPaidByALockedRunCannotBePaidAgain() {
        PliAward a = award(PliStatus.PAID, UUID.randomUUID());
        assertThatThrownBy(() -> service.pay(a.getId()))
                .isInstanceOf(BusinessRuleException.class)
                .satisfies(e -> assertThat(((BusinessRuleException) e).getErrorCode()).isEqualTo("PLI_IN_PAYROLL"));
        verify(awards, never()).save(any());
    }

    @Test
    void anAwardNoRunIncludesCanStillBePaidOutsidePayroll() {
        PliAward a = award(PliStatus.APPROVED, null);
        service.pay(a.getId());
        assertThat(a.getStatus()).isEqualTo(PliStatus.PAID);
        assertThat(a.getPaidAt()).isNotNull();
    }

    @Test
    void approvingRecordsWhenSoTheRightRunPicksItUp() {
        PliAward a = award(PliStatus.PROPOSED, null);
        service.decide(a.getId(), new PliDecisionRequest(true));
        assertThat(a.getStatus()).isEqualTo(PliStatus.APPROVED);
        assertThat(a.getApprovedAt()).isNotNull();

        PliAward b = award(PliStatus.PROPOSED, null);
        service.decide(b.getId(), new PliDecisionRequest(false));
        assertThat(b.getApprovedAt()).isNull();
    }
}
