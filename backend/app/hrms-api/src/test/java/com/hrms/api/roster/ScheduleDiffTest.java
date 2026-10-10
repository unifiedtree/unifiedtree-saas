package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterStore.Cell;
import com.hrms.api.roster.RosterStore.Day;
import com.hrms.api.roster.RosterStore.DayChange;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** The publish diff, the date wording used in messages, and a shift's cell code. */
class ScheduleDiffTest {

    static final UUID RAVI = UUID.randomUUID(), ROSTER = UUID.randomUUID(), A = UUID.randomUUID(), B = UUID.randomUUID();
    static final LocalDate D1 = LocalDate.of(2026, 10, 12);

    @Test
    void addedChangedRemovedAndUnchanged() {
        List<Cell> desired = List.of(
                new Cell(RAVI, D1, "SHIFT", A, false),               // unchanged
                new Cell(RAVI, D1.plusDays(1), "SHIFT", B, true),    // A → B
                new Cell(RAVI, D1.plusDays(2), "WO", null, false),   // A → WO
                new Cell(RAVI, D1.plusDays(4), "SHIFT", A, false));  // new
        List<Day> existing = List.of(
                new Day(RAVI, D1, "SHIFT", A, ROSTER, "R", 1),
                new Day(RAVI, D1.plusDays(1), "SHIFT", A, ROSTER, "R", 1),
                new Day(RAVI, D1.plusDays(2), "SHIFT", A, ROSTER, "R", 1),
                new Day(RAVI, D1.plusDays(3), "SHIFT", A, ROSTER, "R", 1));  // cleared
        List<DayChange> out = ScheduleDiff.between(desired, existing);
        assertEquals(List.of(D1.plusDays(1), D1.plusDays(2), D1.plusDays(3), D1.plusDays(4)), out.stream().map(DayChange::date).toList());
        assertEquals(List.of(ChangeKind.CHANGED, ChangeKind.CHANGED, ChangeKind.REMOVED, ChangeKind.ADDED),
                out.stream().map(DayChange::change).toList());
        DayChange toWo = out.get(1);
        assertEquals("SHIFT", toWo.oldKind());
        assertEquals(A, toWo.oldShiftPolicyId());
        assertEquals("WO", toWo.newKind());
        assertNull(toWo.newShiftPolicyId());
        assertNull(out.get(2).newKind());
        assertNull(out.get(3).oldKind());
        assertTrue(ScheduleDiff.between(List.of(), List.of()).isEmpty());
    }

    @Test
    void datesAreWrittenAsRuns() {
        assertEquals("3–5 Oct, 9 Oct", ScheduleDiff.dates(List.of(LocalDate.of(2026, 10, 9), LocalDate.of(2026, 10, 3),
                LocalDate.of(2026, 10, 4), LocalDate.of(2026, 10, 5))));
        assertEquals("30 Sep–2 Oct", ScheduleDiff.dates(List.of(LocalDate.of(2026, 9, 30), LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 2))));
        assertEquals("12 Oct", ScheduleDiff.dates(List.of(D1, D1)));
    }

    @Test
    void aShiftsCodeIsItsCodeElseItsNamesFirstLetters() {
        assertEquals("A", ShiftCatalog.Shift.label(" A ", "Morning"));
        assertEquals("G", ShiftCatalog.Shift.label(null, "General"));
        assertEquals("NS", ShiftCatalog.Shift.label("", "Night shift"));
        assertEquals("S96", ShiftCatalog.Shift.label(null, "Standard 9-6 night"), "at most three");
        assertEquals("?", ShiftCatalog.Shift.label(null, " "));
    }

    @Test
    void cellTokensAreTheShiftIdOrWo() {
        assertEquals(A.toString(), RosterStore.token("SHIFT", A));
        assertEquals("WO", RosterStore.token("WO", null));
        assertNull(RosterStore.token(null, null));
        assertEquals("{a,NULL,b}", RosterStore.array(java.util.Arrays.asList("a", null, "b"), x -> x));
    }
}
