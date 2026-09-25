package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Recording a value needs a target: without one the KPI path wrote 0% over the
 * percentage the owner set on their personal goal.
 */
class KpiTargetRequiredTest {

    @Test void aGoalWithoutATargetTakesNoRecordedValue() {
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> KpiService.requireTarget(null));
        assertEquals("KPI_TARGET_REQUIRED", e.getErrorCode());
        assertTrue(e.getMessage().contains("My goals"));
    }

    @Test void aGoalWithATargetDoes() {
        assertDoesNotThrow(() -> KpiService.requireTarget(BigDecimal.valueOf(100)));
        assertDoesNotThrow(() -> KpiService.requireTarget(BigDecimal.ZERO));
    }
}
