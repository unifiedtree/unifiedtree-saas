package com.hrms.leave.service;

import com.hrms.leave.dto.LeaveBalanceResponse.NextCredit;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/** The notes under a leave balance (HRMS redesign BW-49): only rules that run today. */
class LeaveBalanceNotesTest {

    private static final LocalDate SEP_27 = LocalDate.of(2026, 9, 27);

    @Test void monthlyTypesAreCreditedOnTheFirstOfNextMonthWithTheJobsRounding() {
        NextCredit n = LeaveBalanceNotes.nextCredit("MONTHLY", 18, null, 2026, SEP_27, true);
        assertEquals(new NextCredit(1.5, LocalDate.of(2026, 10, 1)), n);
        // 10 a year: the job tops up to round2(10 * periods / 12), so the October credit is 8.33 - 7.5 = 0.83.
        assertEquals(0.83, LeaveBalanceNotes.nextCredit("MONTHLY", 10, null, 2026, SEP_27, true).days());
        assertEquals(0.84, LeaveBalanceNotes.nextCredit("MONTHLY", 10, null, 2026, LocalDate.of(2026, 1, 15), true).days());
    }

    @Test void quarterlyTypesAreCreditedOnTheFirstDayOfTheNextQuarter() {
        assertEquals(new NextCredit(2, LocalDate.of(2026, 10, 1)),
                LeaveBalanceNotes.nextCredit("QUARTERLY", 8, null, 2026, SEP_27, true));
        assertEquals(new NextCredit(2, LocalDate.of(2026, 4, 1)),
                LeaveBalanceNotes.nextCredit("QUARTERLY", 8, null, 2026, LocalDate.of(2026, 3, 31), true));
    }

    @Test void noCreditNoteWhenNothingIsCreditedDuringThisYear() {
        // Yearly (and unknown / blank) types get the whole quota on 1 January.
        assertNull(LeaveBalanceNotes.nextCredit("YEARLY", 12, null, 2026, SEP_27, true));
        assertNull(LeaveBalanceNotes.nextCredit(null, 12, null, 2026, SEP_27, true));
        // The last month / quarter: the next credit belongs to next year's balance.
        assertNull(LeaveBalanceNotes.nextCredit("MONTHLY", 12, null, 2026, LocalDate.of(2026, 12, 5), true));
        assertNull(LeaveBalanceNotes.nextCredit("QUARTERLY", 12, null, 2026, LocalDate.of(2026, 11, 5), true));
        // Another year's balance.
        assertNull(LeaveBalanceNotes.nextCredit("MONTHLY", 12, null, 2025, SEP_27, true));
        assertNull(LeaveBalanceNotes.nextCredit("MONTHLY", 12, null, 2027, SEP_27, true));
        // Someone the nightly credit skips (they have left).
        assertNull(LeaveBalanceNotes.nextCredit("MONTHLY", 12, null, 2026, SEP_27, false));
        // Nothing to credit.
        assertNull(LeaveBalanceNotes.nextCredit("MONTHLY", 0, null, 2026, SEP_27, true));
    }

    @Test void joiningDecidesWhenTheFirstCreditComes() {
        // Joined in September: October's credit comes as usual.
        assertEquals(new NextCredit(1, LocalDate.of(2026, 10, 1)),
                LeaveBalanceNotes.nextCredit("MONTHLY", 12, LocalDate.of(2026, 9, 2), 2026, SEP_27, true));
        // Joins in November: nothing on 1 October.
        assertNull(LeaveBalanceNotes.nextCredit("MONTHLY", 12, LocalDate.of(2026, 11, 2), 2026, SEP_27, true));
        assertNull(LeaveBalanceNotes.nextCredit("MONTHLY", 12, LocalDate.of(2027, 1, 2), 2026, SEP_27, true));
    }

    @Test void theLeaveYearResetsOnTheFirstOfJanuary() {
        assertEquals(LocalDate.of(2027, 1, 1), LeaveBalanceNotes.resetsOn(2026));
    }

    @Test void theCarryForwardCapIsWhatTheYearEndRunCarries() {
        assertEquals(30, LeaveBalanceNotes.carryForwardCap(true, 30));
        assertEquals(0, LeaveBalanceNotes.carryForwardCap(true, 0));
        assertEquals(0, LeaveBalanceNotes.carryForwardCap(true, null));
        assertEquals(0, LeaveBalanceNotes.carryForwardCap(false, 30));
        // The same rule as the carry forward itself.
        assertArrayEquals(new double[]{0, 5}, LeaveAccrualMath.carryForward(5, false, 30));
        assertArrayEquals(new double[]{5, 0}, LeaveAccrualMath.carryForward(5, true, 30));
    }

    @Test void theNightlyCreditRunsForTheSameStatusesAsTheJob() {
        for (String s : new String[]{"ACTIVE", "PROBATION", "NOTICE_PERIOD", "ON_LEAVE"}) {
            assertTrue(LeaveBalanceNotes.creditedStatus(s, true), s);
            assertFalse(LeaveBalanceNotes.creditedStatus(s, false), s + " inactive");
        }
        for (String s : new String[]{"EXITED", "TERMINATED", "RESIGNED", "RETIRED", "SUSPENDED"}) {
            assertFalse(LeaveBalanceNotes.creditedStatus(s, true), s);
        }
        assertFalse(LeaveBalanceNotes.creditedStatus(null, true));
    }
}
