package com.hrms.attendance.dto;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** "How late" is only meaningful for a LATE record with a scheduled start. */
class StaffStatusLateByTest {

    private final Instant nineIst = Instant.parse("2026-09-24T03:30:00Z");

    @Test
    void lateRecordReportsMinutesAfterScheduledStart() {
        assertEquals(47, StaffStatusResponse.lateBy("LATE", Instant.parse("2026-09-24T04:17:00Z"), nineIst));
    }

    @Test
    void onTimeOrUnscheduledRecordsReportNothing() {
        assertNull(StaffStatusResponse.lateBy("ON_TIME", Instant.parse("2026-09-24T04:17:00Z"), nineIst));
        assertNull(StaffStatusResponse.lateBy("LATE", null, nineIst));
        assertNull(StaffStatusResponse.lateBy("LATE", Instant.parse("2026-09-24T04:17:00Z"), null));
        // A LATE status with a check-in at/before the start (set under an earlier
        // policy) must not report a zero or negative lateness.
        assertNull(StaffStatusResponse.lateBy("LATE", nineIst, nineIst));
    }
}
