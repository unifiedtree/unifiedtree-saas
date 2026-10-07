package com.hrms.core.dto;

import com.hrms.core.exception.HrmsException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/** The optional ?from=&to= of the paged lists (calendar everywhere, 7 Oct 2026). */
class ListDateRangeTest {

    @Test void neitherIsNoRangeSoTheListIsAsBefore() {
        assertNull(ListDateRange.parse(null, null));
        assertNull(ListDateRange.parse("", "  "));
    }

    @Test void bothAreAnInclusiveRangeOfIndiaDays() {
        ListDateRange r = ListDateRange.parse("2026-10-01", " 2026-10-07 ");
        assertEquals(LocalDate.of(2026, 10, 1), r.from());
        assertEquals(LocalDate.of(2026, 10, 7), r.to());
        // 1 Oct 00:00 IST = 30 Sep 18:30 UTC; the end is 8 Oct 00:00 IST, exclusive.
        assertEquals(Instant.parse("2026-09-30T18:30:00Z"), r.startsAt());
        assertEquals(Instant.parse("2026-10-07T18:30:00Z"), r.endsBefore());
        assertEquals(r.startsAt(), r.startsAtOffset().toInstant());
        assertEquals(r.endsBefore(), r.endsBeforeOffset().toInstant());
    }

    @Test void oneDayIsFine() {
        ListDateRange r = ListDateRange.parse("2026-10-07", "2026-10-07");
        assertEquals(r.from(), r.to());
    }

    @Test void aWholeLeapYearIsTheLongest() {
        assertNotNull(ListDateRange.parse("2028-01-01", "2028-12-31"));   // 366 days
        HrmsException e = assertThrows(HrmsException.class, () -> ListDateRange.parse("2026-01-01", "2027-01-02"));
        assertEquals("Pick 366 days or fewer. This range is 367 days.", e.getMessage());
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals("INVALID_DATE_RANGE", e.getErrorCode());
    }

    @Test void backwardsIsRefusedInPlainWords() {
        HrmsException e = assertThrows(HrmsException.class, () -> ListDateRange.parse("2026-10-08", "2026-10-07"));
        assertEquals("The start date must be on or before the end date.", e.getMessage());
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
    }

    @Test void onlyOneEndIsRefused() {
        assertThrows(HrmsException.class, () -> ListDateRange.parse("2026-10-01", null));
        assertThrows(HrmsException.class, () -> ListDateRange.parse(null, "2026-10-01"));
    }

    @Test void aBrokenDateIsRefused() {
        HrmsException e = assertThrows(HrmsException.class, () -> ListDateRange.parse("2026-02-30", "2026-03-01"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertThrows(HrmsException.class, () -> ListDateRange.parse("07/10/2026", "2026-10-08"));
    }
}
