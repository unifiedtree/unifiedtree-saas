package com.hrms.attendance.policy;

import com.hrms.attendance.policy.AttendancePolicyService.PolicyUpdate;
import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** What the attendance policy save refuses, with the message people see. */
class AttendancePolicyValidationTest {

    private static PolicyUpdate ok() {
        return new PolicyUpdate(15, "09:15", 120, 8.0, 4.0, 30, 2, "WEEK", "HALF_DAY");
    }

    private static String refused(PolicyUpdate u) {
        return assertThrows(BusinessRuleException.class, () -> AttendancePolicyService.validate(u)).getMessage();
    }

    @Test
    void aSensiblePolicySaves() {
        assertDoesNotThrow(() -> AttendancePolicyService.validate(ok()));
        assertDoesNotThrow(() -> AttendancePolicyService.validate(
                new PolicyUpdate(0, "10:00", null, null, null, 0, 0, "month", "keep_late")));
    }

    @Test
    void rangesAndFormatsAreChecked() {
        assertTrue(refused(new PolicyUpdate(-1, "09:15", null, null, null, 0, 0, "MONTH", "KEEP_LATE")).contains("grace"));
        assertTrue(refused(new PolicyUpdate(15, "9.15am", null, null, null, 0, 0, "MONTH", "KEEP_LATE")).contains("09:30"));
        assertTrue(refused(new PolicyUpdate(15, "09:15", null, null, null, 700, 0, "MONTH", "KEEP_LATE")).contains("early-leave"));
        assertTrue(refused(new PolicyUpdate(15, "09:15", null, null, null, 0, 8, "WEEK", "KEEP_LATE")).contains("between 0 and 7"));
        assertTrue(refused(new PolicyUpdate(15, "09:15", null, null, null, 0, 0, "YEAR", "KEEP_LATE")).contains("week or per month"));
        assertTrue(refused(new PolicyUpdate(15, "09:15", null, null, null, 0, 0, "MONTH", "FIRE")).contains("loss of pay"));
    }

    @Test
    void theHalfDayLimitMustBeAfterTheGrace() {
        assertTrue(refused(new PolicyUpdate(30, "09:15", 20, null, null, 0, 0, "MONTH", "KEEP_LATE")).contains("more than the grace"));
    }

    @Test
    void halfDayHoursMustBeUnderFullDayHours() {
        assertTrue(refused(new PolicyUpdate(15, "09:15", null, 4.0, 6.0, 0, 0, "MONTH", "KEEP_LATE")).contains("less than for a full day"));
        assertTrue(refused(new PolicyUpdate(15, "09:15", null, 25.0, null, 0, 0, "MONTH", "KEEP_LATE")).contains("at most 24"));
    }
}
