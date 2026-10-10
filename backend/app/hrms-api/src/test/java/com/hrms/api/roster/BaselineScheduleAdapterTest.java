package com.hrms.api.roster;

import com.hrms.attendance.service.EffectiveShiftResolver.EffectiveShift;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The baseline (today's answer with no roster, design §0.2): one entry per person and date; the shift
 * in force is the resolver's pick for each date (the latest assignment covering it, none when nothing
 * covers it); the weekly off is attendance's rule, asked on the first day and wherever someone's
 * assignments start or end.
 */
class BaselineScheduleAdapterTest {

    static final UUID RAVI = UUID.randomUUID(), SITA = UUID.randomUUID();
    static final UUID A = UUID.randomUUID(), B = UUID.randomUUID(), C = UUID.randomUUID();
    static final LocalDate MON = LocalDate.of(2026, 10, 12);

    static EffectiveShift of(UUID e, LocalDate from, LocalDate to, UUID shift) {
        return new EffectiveShift(e, null, from, to, shift, null, null, "Shift", "FIXED", null, null, null, null, null, null);
    }

    @Test
    void everyPersonGetsEveryDateWithTheShiftInForceAndTheirWeeklyOff() {
        Map<UUID, List<EffectiveShift>> rows = new HashMap<>();
        // Ravi: A since January until Tuesday, B from Wednesday, a temporary C on Friday and Saturday.
        rows.put(RAVI, List.of(of(RAVI, MON.plusDays(4), MON.plusDays(5), C), of(RAVI, MON.plusDays(2), null, B),
                of(RAVI, LocalDate.of(2026, 1, 1), MON.plusDays(1), A)));
        List<LocalDate> asked = new ArrayList<>();
        BaselineScheduleAdapter adapter = new BaselineScheduleAdapter(null) {
            @Override Map<UUID, List<EffectiveShift>> shifts(List<UUID> ids, LocalDate from, LocalDate to) {
                return rows;
            }
            @Override Map<UUID, Set<Integer>> weeklyOffDays(List<UUID> ids, LocalDate date) {
                asked.add(date);
                // Ravi's offs follow his shift's from Friday (C has Friday/Saturday off); Sita: Sundays.
                Map<UUID, Set<Integer>> out = new HashMap<>();
                out.put(RAVI, date.isBefore(MON.plusDays(4)) || date.isAfter(MON.plusDays(5)) ? Set.of(6, 7) : Set.of(5, 6));
                out.put(SITA, Set.of(7));
                return out;
            }
        };
        Map<UUID, List<BaselineSchedule.BaselineDay>> out = adapter.between(UUID.randomUUID(), List.of(RAVI, SITA, RAVI), MON, MON.plusDays(6));

        assertEquals(List.of(RAVI, SITA), List.copyOf(out.keySet()), "each person once, in order");
        List<BaselineSchedule.BaselineDay> ravi = out.get(RAVI);
        assertEquals(7, ravi.size());
        assertEquals(MON, ravi.get(0).date());
        assertEquals(List.of(A, A, B, B, C, C, B), ravi.stream().map(BaselineSchedule.BaselineDay::shiftPolicyId).toList());
        assertEquals(List.of(false, false, false, false, true, true, true), ravi.stream().map(BaselineSchedule.BaselineDay::weeklyOff).toList(),
                "Friday and Saturday off on C, Sunday off again after it");
        assertEquals(List.of(MON, MON.plusDays(2), MON.plusDays(4), MON.plusDays(6)), asked,
                "the weekly-off rule is asked on the first day and where assignments start or end");
        List<BaselineSchedule.BaselineDay> sita = out.get(SITA);
        assertTrue(sita.stream().allMatch(d -> d.shiftPolicyId() == null), "no assignment: no shift");
        assertTrue(sita.get(6).weeklyOff());
        assertFalse(sita.get(5).weeklyOff());
    }

    @Test
    void nothingAskedNothingAnswered() {
        BaselineScheduleAdapter adapter = new BaselineScheduleAdapter(null);
        assertTrue(adapter.between(UUID.randomUUID(), List.of(), MON, MON).isEmpty());
        assertTrue(adapter.between(UUID.randomUUID(), null, MON, MON).isEmpty());
        assertTrue(adapter.between(UUID.randomUUID(), List.of(RAVI), MON, MON.minusDays(1)).isEmpty());
    }

    @Test
    void withoutADatabaseTheWeeklyOffIsSaturdayAndSunday() {
        BaselineScheduleAdapter adapter = new BaselineScheduleAdapter(null) {
            @Override Map<UUID, List<EffectiveShift>> shifts(List<UUID> ids, LocalDate from, LocalDate to) {
                return Map.of();
            }
        };
        List<BaselineSchedule.BaselineDay> week = adapter.between(UUID.randomUUID(), List.of(RAVI), MON, MON.plusDays(6)).get(RAVI);
        assertEquals(List.of(false, false, false, false, false, true, true), week.stream().map(BaselineSchedule.BaselineDay::weeklyOff).toList());
    }
}
