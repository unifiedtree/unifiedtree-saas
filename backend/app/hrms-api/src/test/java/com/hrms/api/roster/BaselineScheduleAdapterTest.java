package com.hrms.api.roster;

import com.hrms.api.roster.BaselineScheduleAdapter.Assignment;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The baseline (today's answer with no roster, design §0.2): one entry per person and date; the shift
 * in force is the latest assignment covering the date (the resolver's attendance rule), none when
 * nothing covers it; the weekly off is the attendance rule's (Saturday and Sunday without a database).
 */
class BaselineScheduleAdapterTest {

    static final UUID RAVI = UUID.randomUUID(), SITA = UUID.randomUUID();
    static final UUID A = UUID.randomUUID(), B = UUID.randomUUID(), C = UUID.randomUUID();
    static final LocalDate MON = LocalDate.of(2026, 10, 12);

    static Assignment of(UUID e, LocalDate from, LocalDate to, UUID shift) {
        return new Assignment(e, from, to, shift);
    }

    @Test
    void theLatestAssignmentCoveringTheDateIsInForce() {
        List<Assignment> ravi = List.of(
                of(RAVI, MON.plusDays(3), MON.plusDays(4), C),       // a temporary change Thu–Fri
                of(RAVI, MON.plusDays(1), null, B),                  // from Tue, open-ended
                of(RAVI, LocalDate.of(2026, 1, 1), null, A));        // since January
        assertEquals(A, BaselineScheduleAdapter.inForceOn(ravi, MON).shiftPolicyId());
        assertEquals(B, BaselineScheduleAdapter.inForceOn(ravi, MON.plusDays(1)).shiftPolicyId());
        assertEquals(C, BaselineScheduleAdapter.inForceOn(ravi, MON.plusDays(3)).shiftPolicyId());
        assertEquals(B, BaselineScheduleAdapter.inForceOn(ravi, MON.plusDays(5)).shiftPolicyId(), "after the temporary change");
        assertNull(BaselineScheduleAdapter.inForceOn(ravi, LocalDate.of(2025, 12, 31)), "before any assignment: no shift");
        assertNull(BaselineScheduleAdapter.inForceOn(null, MON));
        // two from the same day: the first, as the resolver
        List<Assignment> tie = List.of(of(SITA, MON, null, B), of(SITA, MON, null, C));
        assertEquals(B, BaselineScheduleAdapter.inForceOn(tie, MON).shiftPolicyId());
    }

    @Test
    void everyPersonGetsEveryDateWithTheirShiftAndWeeklyOff() {
        Map<UUID, List<Assignment>> rows = new HashMap<>();
        rows.put(RAVI, List.of(of(RAVI, MON.plusDays(2), null, B), of(RAVI, LocalDate.of(2026, 1, 1), MON.plusDays(1), A)));
        BaselineScheduleAdapter adapter = new BaselineScheduleAdapter(null) {
            @Override Map<UUID, List<Assignment>> candidates(List<UUID> ids, LocalDate from, LocalDate to) {
                return rows;
            }
        };
        Map<UUID, List<BaselineSchedule.BaselineDay>> out = adapter.between(UUID.randomUUID(), List.of(RAVI, SITA, RAVI), MON, MON.plusDays(6));
        assertEquals(List.of(RAVI, SITA), List.copyOf(out.keySet()), "each person once, in order");
        List<BaselineSchedule.BaselineDay> ravi = out.get(RAVI);
        assertEquals(7, ravi.size());
        assertEquals(MON, ravi.get(0).date());
        assertEquals(A, ravi.get(0).shiftPolicyId());
        assertEquals(A, ravi.get(1).shiftPolicyId());
        assertEquals(B, ravi.get(2).shiftPolicyId());
        assertFalse(ravi.get(4).weeklyOff());
        assertTrue(ravi.get(5).weeklyOff(), "Saturday");
        assertTrue(ravi.get(6).weeklyOff(), "Sunday");
        assertTrue(out.get(SITA).stream().allMatch(d -> d.shiftPolicyId() == null), "no assignment: no shift");
        assertTrue(adapter.between(UUID.randomUUID(), List.of(), MON, MON).isEmpty());
        assertTrue(adapter.between(UUID.randomUUID(), List.of(RAVI), MON, MON.minusDays(1)).isEmpty());
    }
}
