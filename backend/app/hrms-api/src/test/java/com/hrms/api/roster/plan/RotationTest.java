package com.hrms.api.roster.plan;

import com.hrms.api.roster.BaselineSchedule.BaselineDay;
import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Rotation positions, staggered start days and "Continue from" (design §1.3). */
class RotationTest {

    private final PlanFixture fx = new PlanFixture();
    private final List<PatternDay> aabbccwo = fx.pattern("A A B B C C WO");

    @Test
    void spreadIsFloorOfJTimesNOverK() {
        // The design's example: N = 7, 4 people → 0, 1, 3, 5; 7 people → 0..6.
        assertArrayEquals(new int[]{0, 1, 3, 5}, spreads(4, 7));
        assertArrayEquals(new int[]{0, 1, 2, 3, 4, 5, 6}, spreads(7, 7));
        // More people than pattern days wrap round: 9 people on 7 days.
        assertArrayEquals(new int[]{0, 0, 1, 2, 3, 3, 4, 5, 6}, spreads(9, 7));
        assertArrayEquals(new int[]{0}, spreads(1, 7));
        assertEquals(0, Rotation.spread(3, 4, 0), "no pattern: everyone starts at 0");
    }

    private static int[] spreads(int k, int n) {
        int[] out = new int[k];
        for (int j = 0; j < k; j++) out[j] = Rotation.spread(j, k, n);
        return out;
    }

    @Test
    void rotationalPositionIsDayPlusOffsetModN() {
        String a = fx.token("A"), b = fx.token("B"), c = fx.token("C");
        // Offset 3 on A A B B C C WO: B C C WO A A B …
        String[] row = Rotation.row(WeeklyOffMode.ROTATIONAL, aabbccwo, true, 3, new boolean[9]);
        assertEquals(Arrays.asList(b, c, c, RosterContract.WO, a, a, b, b, c), Arrays.asList(row));
    }

    @Test
    void withoutRepeatOnlyTheFirstCycleIsLaid() {
        String[] row = Rotation.row(WeeklyOffMode.ROTATIONAL, fx.pattern("A B WO"), false, 1, new boolean[5]);
        assertEquals(Arrays.asList(fx.token("B"), RosterContract.WO, null, null, null), Arrays.asList(row));
        String[] fromZero = Rotation.row(WeeklyOffMode.ROTATIONAL, fx.pattern("A B WO"), false, 0, new boolean[5]);
        assertEquals(Arrays.asList(fx.token("A"), fx.token("B"), RosterContract.WO, null, null), Arrays.asList(fromZero));
    }

    @Test
    void customLeavesThePatternsWeeklyOffsEmpty() {
        String[] row = Rotation.row(WeeklyOffMode.CUSTOM, aabbccwo, true, 0, new boolean[8]);
        assertNull(row[6], "WO position is left for HR to pick");
        assertEquals(fx.token("A"), row[7]);
    }

    @Test
    void fixedModeKeepsTheUsualOffDaysAndAdvancesOnWorkingDaysOnly() {
        // "A week of A, a week of B" with Saturday and Sunday off, from Monday 5 Oct 2026.
        List<PatternDay> weekly = fx.pattern("A A A A A B B B B B");
        boolean[] off = new boolean[14];
        LocalDate mon = LocalDate.of(2026, 10, 5);
        for (int i = 0; i < 14; i++) {
            DayOfWeek d = mon.plusDays(i).getDayOfWeek();
            off[i] = d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY;
        }
        String[] row = Rotation.row(WeeklyOffMode.FIXED, weekly, true, 0, off);
        String a = fx.token("A"), b = fx.token("B"), wo = RosterContract.WO;
        assertEquals(Arrays.asList(a, a, a, a, a, wo, wo, b, b, b, b, b, wo, wo), Arrays.asList(row));
    }

    @Test
    void fixedModeTreatsAPatternWeeklyOffAsAnExtraDayOff() {
        boolean[] off = {false, false, true, false};
        String[] row = Rotation.row(WeeklyOffMode.FIXED, fx.pattern("A WO"), true, 0, off);
        assertEquals(Arrays.asList(fx.token("A"), RosterContract.WO, RosterContract.WO, fx.token("A")), Arrays.asList(row),
                "day 3 is the usual off day (WO) and does not advance the cycle");
    }

    @Test
    void emptyPatternLaysNothing() {
        String[] row = Rotation.row(WeeklyOffMode.ROTATIONAL, List.of(), true, 0, new boolean[3]);
        assertEquals(Collections.nCopies(3, null), Arrays.asList(row));
        String[] fixed = Rotation.row(WeeklyOffMode.FIXED, List.of(), true, 0, new boolean[]{false, true});
        assertEquals(Arrays.asList(null, RosterContract.WO), Arrays.asList(fixed), "Fixed still marks the usual off days");
    }

    @Test
    void offsetsSpreadWithinEachDesignationAndKeepGivenOnes() {
        UUID[] ids = new UUID[6];
        for (int i = 0; i < 6; i++) ids[i] = UUID.randomUUID();
        List<UUID> members = List.of(ids);
        // Designations: T T H T H T  → technicians 0,1,3,5 (4 people), helpers 2,4 (2 people).
        UUID t = PlanFixture.TECH, h = PlanFixture.HELPER;
        List<UUID> designations = Arrays.asList(t, t, h, t, h, t);
        int[] none = {-1, -1, -1, -1, -1, -1};
        int[] spread = Rotation.offsets(members, designations, none, StaggerMode.SPREAD, aabbccwo,
                LocalDate.of(2026, 10, 1), null, Map.of());
        assertArrayEquals(new int[]{0, 1, 0, 3, 3, 5}, spread, "technicians 0,1,3,5; helpers 0 and floor(7/2) = 3");

        int[] same = Rotation.offsets(members, designations, none, StaggerMode.SAME, aabbccwo,
                LocalDate.of(2026, 10, 1), null, Map.of());
        assertArrayEquals(new int[6], same);

        int[] kept = Rotation.offsets(members, designations, new int[]{4, -1, 9, -1, -1, -1}, StaggerMode.SPREAD, aabbccwo,
                LocalDate.of(2026, 10, 1), null, Map.of());
        assertEquals(4, kept[0], "a given offset is kept");
        assertEquals(2, kept[2], "and normalised to the pattern (9 mod 7)");
        assertEquals(1, kept[1], "a new one takes its place in the designation's spread");
    }

    @Test
    void noDesignationIsItsOwnGroup() {
        List<UUID> members = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        int[] out = Rotation.offsets(members, Arrays.asList(null, PlanFixture.TECH, null), new int[]{-1, -1, -1},
                StaggerMode.SPREAD, aabbccwo, LocalDate.of(2026, 10, 1), null, Map.of());
        assertArrayEquals(new int[]{0, 0, 3}, out);
    }

    @Test
    void normalizeKeepsOffsetsInTheStoredRange() {
        assertEquals(3, Rotation.normalize(10, 7));
        assertEquals(6, Rotation.normalize(-1, 7));
        assertEquals(61, Rotation.normalize(200, 0), "no pattern: clamped to 0..61");
        assertEquals(0, Rotation.normalize(-5, 0));
    }

    @Test
    void continuingARotationalRosterKeepsTheCycleAcrossTheMonthBoundary() {
        UUID ravi = UUID.randomUUID(), newcomer = UUID.randomUUID();
        LocalDate sep1 = LocalDate.of(2026, 9, 1), sep30 = LocalDate.of(2026, 9, 30), oct1 = LocalDate.of(2026, 10, 1);
        PlanFacts.PreviousRoster september = new PlanFacts.PreviousRoster(UUID.randomUUID(), "September", sep1, sep30,
                aabbccwo, WeeklyOffMode.ROTATIONAL, Map.of(ravi, 2));
        // Design: o = (o_prev + (start − start_prev)) mod N = (2 + 30) mod 7 = 4.
        assertEquals(4, Rotation.continued(september, ravi, oct1, 7, Map.of()));
        // Ravi's position on 30 Sep was (29 + 2) mod 7 = 3, so 1 Oct is position 4: the cycle is unbroken.
        String[] sep = Rotation.row(WeeklyOffMode.ROTATIONAL, aabbccwo, true, 2, new boolean[30]);
        String[] oct = Rotation.row(WeeklyOffMode.ROTATIONAL, aabbccwo, true, 4, new boolean[31]);
        String[] both = new String[61];
        System.arraycopy(sep, 0, both, 0, 30);
        System.arraycopy(oct, 0, both, 30, 31);
        String[] straight = Rotation.row(WeeklyOffMode.ROTATIONAL, aabbccwo, true, 2, new boolean[61]);
        assertArrayEquals(straight, both);

        int[] offsets = Rotation.offsets(List.of(ravi, newcomer), Arrays.asList(PlanFixture.TECH, PlanFixture.TECH),
                new int[]{-1, -1}, StaggerMode.CONTINUE, aabbccwo, oct1, september, Map.of());
        assertArrayEquals(new int[]{4, 3}, offsets, "Ravi continues; the newcomer is spread (j = 1 of 2 → 3)");
    }

    @Test
    void continuingAFixedRosterCountsTheWorkingDaysOfThePreviousPeriod() {
        UUID ravi = UUID.randomUUID();
        List<PatternDay> weekly = fx.pattern("A A A A A B B B B B");
        LocalDate sep1 = LocalDate.of(2026, 9, 1), oct1 = LocalDate.of(2026, 10, 1);
        Map<UUID, Map<LocalDate, BaselineDay>> base = new HashMap<>();
        Map<LocalDate, BaselineDay> days = new HashMap<>();
        for (LocalDate d = sep1; d.isBefore(oct1); d = d.plusDays(1)) {
            DayOfWeek w = d.getDayOfWeek();
            days.put(d, new BaselineDay(d, null, w == DayOfWeek.SATURDAY || w == DayOfWeek.SUNDAY));
        }
        base.put(ravi, days);
        PlanFacts.PreviousRoster september = new PlanFacts.PreviousRoster(UUID.randomUUID(), "September", sep1,
                LocalDate.of(2026, 9, 30), weekly, WeeklyOffMode.FIXED, Map.of(ravi, 0));
        // September 2026 has 22 working days (Mon–Fri): (0 + 22) mod 10 = 2.
        assertEquals(2, Rotation.continued(september, ravi, oct1, 10, base));
    }

    @Test
    void continueNeedsTheSamePatternAndARosterEndingTheDayBefore() {
        UUID ravi = UUID.randomUUID();
        LocalDate oct1 = LocalDate.of(2026, 10, 1);
        PlanFacts.PreviousRoster other = new PlanFacts.PreviousRoster(UUID.randomUUID(), "September",
                LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), fx.pattern("A B WO"), WeeklyOffMode.ROTATIONAL,
                Map.of(ravi, 2));
        assertFalse(Rotation.usable(other, aabbccwo, oct1), "another pattern");
        PlanFacts.PreviousRoster gap = new PlanFacts.PreviousRoster(UUID.randomUUID(), "September",
                LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 29), aabbccwo, WeeklyOffMode.ROTATIONAL, Map.of(ravi, 2));
        assertFalse(Rotation.usable(gap, aabbccwo, oct1), "ends two days before");
        int[] spread = Rotation.offsets(List.of(ravi), List.of(PlanFixture.TECH), new int[]{-1}, StaggerMode.CONTINUE,
                aabbccwo, oct1, other, Map.of());
        assertArrayEquals(new int[]{0}, spread, "falls back to spreading");
    }

    @Test
    void continuationAcrossTheYearEnd() {
        UUID ravi = UUID.randomUUID();
        PlanFacts.PreviousRoster december = new PlanFacts.PreviousRoster(UUID.randomUUID(), "December",
                LocalDate.of(2026, 12, 1), LocalDate.of(2026, 12, 31), aabbccwo, WeeklyOffMode.ROTATIONAL, Map.of(ravi, 6));
        // (6 + 31) mod 7 = 2.
        assertEquals(2, Rotation.continued(december, ravi, LocalDate.of(2027, 1, 1), 7, Map.of()));
        assertNull(Rotation.continued(december, UUID.randomUUID(), LocalDate.of(2027, 1, 1), 7, Map.of()),
                "not on the previous roster");
    }

    @Test
    void samePatternComparesShiftsAndOffDays() {
        assertTrue(Rotation.samePattern(fx.pattern("A A B WO"), fx.pattern("A A B WO")));
        assertTrue(Rotation.samePattern(fx.pattern("A WO"), List.of(new PatternDay(fx.id("A"), false), new PatternDay(null, false))),
                "a day with no shift is a weekly off");
        assertFalse(Rotation.samePattern(fx.pattern("A A B WO"), fx.pattern("A B A WO")));
        assertFalse(Rotation.samePattern(fx.pattern("A"), null));
    }
}
