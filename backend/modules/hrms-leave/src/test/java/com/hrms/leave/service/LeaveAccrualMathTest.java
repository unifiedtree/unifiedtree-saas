package com.hrms.leave.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/** The accrual and carry-forward rules (V143.23), pinned without a database. */
class LeaveAccrualMathTest {

    private static final LocalDate SEP_25 = LocalDate.of(2026, 9, 25);

    @Test void unknownOrUpfrontFrequenciesAreYearly() {
        assertEquals("YEARLY", LeaveAccrualMath.normalizeFrequency(null));
        assertEquals("YEARLY", LeaveAccrualMath.normalizeFrequency("upfront"));
        assertEquals("YEARLY", LeaveAccrualMath.normalizeFrequency("ANNUAL"));
        assertEquals("MONTHLY", LeaveAccrualMath.normalizeFrequency(" monthly "));
        assertEquals("QUARTERLY", LeaveAccrualMath.normalizeFrequency("Quarterly"));
        assertTrue(LeaveAccrualMath.isKnownFrequency("UPFRONT"));
        assertFalse(LeaveAccrualMath.isKnownFrequency("WEEKLY"));
        assertFalse(LeaveAccrualMath.isAccruing("YEARLY"));
        assertTrue(LeaveAccrualMath.isAccruing("MONTHLY"));
    }

    @Test void yearlyIsTheWholeQuotaRegardlessOfJoining() {
        assertEquals(21.0, LeaveAccrualMath.entitlementToDate("YEARLY", 21, LocalDate.of(2026, 9, 1), 2026, SEP_25));
    }

    @Test void monthlyCreditsEachMonthFromJanuaryOrTheJoiningMonth() {
        // Nine months (Jan–Sep) of 21/12 = 1.75.
        assertEquals(15.75, LeaveAccrualMath.entitlementToDate("MONTHLY", 21, LocalDate.of(2020, 1, 1), 2026, SEP_25));
        // Joined on 20 Aug: August and September.
        assertEquals(3.5, LeaveAccrualMath.entitlementToDate("MONTHLY", 21, LocalDate.of(2026, 8, 20), 2026, SEP_25));
        // Joins next month: nothing yet.
        assertEquals(0.0, LeaveAccrualMath.entitlementToDate("MONTHLY", 21, LocalDate.of(2026, 10, 1), 2026, SEP_25));
        // A past year is fully credited; a future year not at all.
        assertEquals(21.0, LeaveAccrualMath.entitlementToDate("MONTHLY", 21, null, 2025, SEP_25));
        assertEquals(0.0, LeaveAccrualMath.entitlementToDate("MONTHLY", 21, null, 2027, SEP_25));
    }

    @Test void quarterlyCreditsAQuarterAtATime() {
        // Q1–Q3 of 12/4 = 3.
        assertEquals(9.0, LeaveAccrualMath.entitlementToDate("QUARTERLY", 12, null, 2026, SEP_25));
        // Joined in May (Q2): Q2 and Q3.
        assertEquals(6.0, LeaveAccrualMath.entitlementToDate("QUARTERLY", 12, LocalDate.of(2026, 5, 10), 2026, SEP_25));
        assertEquals(12.0, LeaveAccrualMath.entitlementToDate("QUARTERLY", 12, null, 2026, LocalDate.of(2026, 10, 1)));
    }

    @Test void periodKeysAreStableAndReadable() {
        assertEquals("2026-09", LeaveAccrualMath.periodKey("MONTHLY", 2026, 9));
        assertEquals("2026-Q3", LeaveAccrualMath.periodKey("QUARTERLY", 2026, 3));
        assertEquals("2026", LeaveAccrualMath.periodKey("YEARLY", 2026, 1));
        assertEquals("Sep 2026", LeaveAccrualMath.periodLabel("MONTHLY", 2026, 9));
        assertEquals("Jul–Sep 2026", LeaveAccrualMath.periodLabel("QUARTERLY", 2026, 3));
        assertEquals(1.75, LeaveAccrualMath.perPeriod("MONTHLY", 21));
    }

    @Test void carryForwardKeepsUpToTheCapAndLapsesTheRest() {
        assertArrayEquals(new double[]{10, 2.5}, LeaveAccrualMath.carryForward(12.5, true, 10));
        assertArrayEquals(new double[]{4, 0}, LeaveAccrualMath.carryForward(4, true, 10));
        // No carry forward, or a cap of 0: everything lapses.
        assertArrayEquals(new double[]{0, 6}, LeaveAccrualMath.carryForward(6, false, 10));
        assertArrayEquals(new double[]{0, 6}, LeaveAccrualMath.carryForward(6, true, 0));
        // Nothing unused (or overdrawn): nothing to do.
        assertArrayEquals(new double[]{0, 0}, LeaveAccrualMath.carryForward(-1, true, 10));
    }
}
