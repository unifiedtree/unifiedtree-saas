package com.hrms.leave.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.leave.dto.LeaveTypeRequest;
import com.hrms.leave.entity.LeaveType;
import com.hrms.leave.enums.LeaveCategory;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;

/** Encashment limits and pay, and the leave-type settings behind them (V143.23). */
class LeaveEncashmentRulesTest {

    @Test void canRequestIsTheBalanceCappedByWhatIsLeftOfTheYearlyLimitInHalfDays() {
        assertEquals(7.5, LeaveEncashmentService.canRequest(7.75, null, 0));
        assertEquals(3.0, LeaveEncashmentService.canRequest(10, 10, 7));
        assertEquals(0.0, LeaveEncashmentService.canRequest(10, 5, 5));
        assertEquals(0.0, LeaveEncashmentService.canRequest(10, 5, 8));
    }

    @Test void oneDaysPayIsMonthlyBasicOverThirty() {
        assertEquals(new BigDecimal("1000.00"), LeaveEncashmentService.rateFromBasic(new BigDecimal("30000")));
        assertNull(LeaveEncashmentService.rateFromBasic(null));
        assertNull(LeaveEncashmentService.rateFromBasic(BigDecimal.ZERO));
        assertEquals(new BigDecimal("2500.00"), LeaveEncashmentService.amountFor(new BigDecimal("1000.00"), 2.5));
        assertNull(LeaveEncashmentService.amountFor(null, 2));
    }

    private static LeaveTypeRequest request(String accrual, Boolean encashable, Integer maxEncash) {
        return new LeaveTypeRequest("Earned", "EL", LeaveCategory.EARNED, 18, 0, 0, true, 10, true, null, null,
                accrual, encashable, maxEncash);
    }

    @Test void olderClientsThatDontSendTheNewFieldsKeepThem() {
        LeaveType t = new LeaveType();
        LeaveTypeService.applyAccrualAndEncashment(t, request("monthly", true, 5));
        assertEquals("MONTHLY", t.getAccrualFrequency());
        assertTrue(t.isEncashable());
        assertEquals(5, t.getMaxEncashDays());
        // The pre-V143.23 request shape sends nulls: nothing changes.
        LeaveTypeService.applyAccrualAndEncashment(t, new LeaveTypeRequest("Earned", "EL", LeaveCategory.EARNED, 18, 0, 0,
                true, 10, true, null, null));
        assertEquals("MONTHLY", t.getAccrualFrequency());
        assertTrue(t.isEncashable());
        assertEquals(5, t.getMaxEncashDays());
        // 0 clears the yearly limit; UPFRONT is stored as YEARLY.
        LeaveTypeService.applyAccrualAndEncashment(t, request("UPFRONT", false, 0));
        assertEquals("YEARLY", t.getAccrualFrequency());
        assertFalse(t.isEncashable());
        assertNull(t.getMaxEncashDays());
    }

    @Test void anUnknownFrequencyIsRefused() {
        LeaveType t = new LeaveType();
        var e = assertThrows(BusinessRuleException.class,
                () -> LeaveTypeService.applyAccrualAndEncashment(t, request("WEEKLY", null, null)));
        assertEquals("LEAVE_ACCRUAL_INVALID", e.getErrorCode());
    }
}
