package com.hrms.leave.service;

import com.hrms.leave.dto.LeaveTypeRequest;
import com.hrms.leave.enums.LeaveCategory;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A leave type can have an annual quota of 0 (5 Oct 2026, client: "I'm not able
 * to keep the leaves as zero"): both web editors and the mobile app send the
 * quota to the same request, which refused 0. A negative quota is still refused.
 */
class LeaveTypeZeroQuotaTest {

    private static LeaveTypeRequest withQuota(double quota) {
        return new LeaveTypeRequest("Comp off", "CO", LeaveCategory.COMPENSATORY, quota, 0, 0, false, 0, true, null, null,
                "MONTHLY", null, null);
    }

    private static Set<ConstraintViolation<LeaveTypeRequest>> violations(LeaveTypeRequest r) {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            return factory.getValidator().validate(r);
        }
    }

    @Test void zeroAndPositiveQuotasAreAccepted() {
        assertTrue(violations(withQuota(0)).isEmpty());
        assertTrue(violations(withQuota(12)).isEmpty());
        assertTrue(violations(withQuota(0.5)).isEmpty());
    }

    @Test void aNegativeQuotaIsRefusedWithAPlainMessage() {
        var v = violations(withQuota(-1));
        assertEquals(1, v.size());
        ConstraintViolation<LeaveTypeRequest> only = v.iterator().next();
        assertEquals("annualEntitlement", only.getPropertyPath().toString());
        assertEquals("Days a year can't be below 0", only.getMessage());
    }

    @Test void aZeroQuotaCreditsNothingAndPromisesNoNextCredit() {
        LocalDate today = LocalDate.of(2026, 10, 5);
        for (String frequency : new String[]{"YEARLY", "MONTHLY", "QUARTERLY"}) {
            assertEquals(0.0, LeaveAccrualMath.entitlementToDate(frequency, 0, null, 2026, today), frequency);
            assertEquals(0.0, LeaveAccrualMath.perPeriod(frequency, 0), frequency);
            assertNull(LeaveBalanceNotes.nextCredit(frequency, 0, null, 2026, today, true), frequency);
        }
    }
}
