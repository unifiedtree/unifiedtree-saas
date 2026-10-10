package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.Overlay;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.ScheduleDay;
import com.hrms.api.roster.RosterContract.ScheduleDaySource;
import com.hrms.api.roster.RosterContract.ScheduleKind;
import com.hrms.api.roster.RosterStore.Day;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The effective schedule (design §0.3, §1.2): a published roster day wins; otherwise today's answer
 * (the person's shift in force and weekly off); holidays and approved leave on top, PH over L/COFF
 * over the planned day. The planned day underneath an overlay is kept as it is.
 */
class EffectiveScheduleTest {

    static final UUID TENANT = UUID.randomUUID(), COMPANY = UUID.randomUUID(), ROSTER = UUID.randomUUID();
    static final UUID RAVI = UUID.randomUUID(), SITA = UUID.randomUUID(), NOBODY = UUID.randomUUID();
    static final LocalDate MON = LocalDate.of(2026, 10, 12);

    final RosterFakes.Store store = new RosterFakes.Store();
    final RosterFakes.Shifts shifts = new RosterFakes.Shifts();
    final ShiftCatalog.Shift a = shifts.add(COMPANY, "A", "Morning", "06:00", "14:00", "FIXED", true);
    final ShiftCatalog.Shift b = shifts.add(COMPANY, "B", "Evening", "14:00", "22:00", "FIXED", true);
    final ShiftCatalog.Shift night = shifts.add(COMPANY, null, "Night Shift", "22:00", "06:00", "FIXED", true);
    final Map<String, String> holidays = new HashMap<>();
    final Map<String, Overlay> leave = new HashMap<>();

    /** Today's answer: Ravi on A, weekly off Sat/Sun; Sita on B, off Sat/Sun; NOBODY has no shift, off Sundays. */
    final BaselineSchedule baseline = (tenant, ids, from, to) -> {
        Map<UUID, List<BaselineSchedule.BaselineDay>> out = new LinkedHashMap<>();
        for (UUID id : ids) {
            List<BaselineSchedule.BaselineDay> days = new ArrayList<>();
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                int dow = d.getDayOfWeek().getValue();
                UUID shift = id.equals(RAVI) ? a.id() : id.equals(SITA) ? b.id() : null;
                boolean off = id.equals(NOBODY) ? dow == 7 : dow >= 6;
                days.add(new BaselineSchedule.BaselineDay(d, shift, off));
            }
            out.put(id, days);
        }
        return out;
    };

    final EffectiveSchedule schedule = new EffectiveSchedule(null, store, baseline, shifts) {
        @Override Map<String, String> holidays(UUID tenant, Collection<UUID> ids, LocalDate from, LocalDate to) {
            return holidays;
        }
        @Override Map<String, Overlay> leave(UUID tenant, Collection<UUID> ids, LocalDate from, LocalDate to) {
            return leave;
        }
    };

    void rostered(UUID e, LocalDate d, String kind, UUID shift) {
        store.days.put(e + "|" + d, new Day(e, d, kind, shift, ROSTER, "October 2026 · Technical", 1));
    }

    List<ScheduleDay> week(UUID who, String name) {
        return schedule.days(TENANT, List.of(new EffectiveSchedule.Person(who, name)), MON, MON.plusDays(6));
    }

    @Test
    void withNoRosterItIsTodaysAnswer() {
        List<ScheduleDay> days = week(RAVI, null);
        assertEquals(7, days.size());
        ScheduleDay mon = days.get(0);
        assertEquals(ScheduleKind.SHIFT, mon.kind());
        assertEquals(a.id(), mon.shiftPolicyId());
        assertEquals("A", mon.code());
        assertEquals("Morning", mon.shiftName());
        assertEquals("06:00", mon.startTime());
        assertEquals("14:00", mon.endTime());
        assertFalse(mon.nightShift());
        assertEquals(ScheduleDaySource.BASELINE, mon.source());
        assertNull(mon.rosterId());
        assertNull(mon.overlay());
        ScheduleDay sat = days.get(5);
        assertEquals(ScheduleKind.WO, sat.kind());
        assertEquals("WO", sat.code());
        assertNull(sat.shiftPolicyId());
        assertEquals(ScheduleKind.NONE, week(NOBODY, null).get(0).kind(), "no shift and not a weekly off");
    }

    @Test
    void aPublishedRosterDayWins() {
        rostered(RAVI, MON.plusDays(1), "SHIFT", b.id());          // Tue: B instead of A
        rostered(RAVI, MON.plusDays(2), "WO", null);               // Wed: a weekly off on a working weekday
        rostered(RAVI, MON.plusDays(5), "SHIFT", night.id());      // Sat: a night shift on the usual day off
        List<ScheduleDay> days = week(RAVI, null);
        assertEquals(ScheduleDaySource.BASELINE, days.get(0).source());
        ScheduleDay tue = days.get(1);
        assertEquals(b.id(), tue.shiftPolicyId());
        assertEquals(ScheduleDaySource.ROSTER, tue.source());
        assertEquals(ROSTER, tue.rosterId());
        assertEquals("October 2026 · Technical", tue.rosterName());
        ScheduleDay wed = days.get(2);
        assertEquals(ScheduleKind.WO, wed.kind());
        assertEquals(ScheduleDaySource.ROSTER, wed.source());
        ScheduleDay sat = days.get(5);
        assertEquals(ScheduleKind.SHIFT, sat.kind());
        assertTrue(sat.nightShift(), "ends before it starts: a night shift");
        assertEquals("NS", sat.code(), "a shift with no code shows its name's first letters");
        assertEquals("22:00", sat.startTime());
        assertEquals(ScheduleKind.WO, days.get(6).kind(), "Sunday: no roster day, so the usual weekly off");
    }

    @Test
    void holidaysThenLeaveAreShownOnTopOfThePlannedDay() {
        rostered(RAVI, MON, "SHIFT", b.id());
        holidays.put(RAVI + "|" + MON, "Diwali");
        leave.put(RAVI + "|" + MON, new Overlay(OverlayType.L, "Casual Leave", false));
        leave.put(RAVI + "|" + MON.plusDays(1), new Overlay(OverlayType.L, "Casual Leave", true));
        leave.put(RAVI + "|" + MON.plusDays(2), new Overlay(OverlayType.COFF, "Comp-off", false));
        leave.put(RAVI + "|" + MON.plusDays(5), new Overlay(OverlayType.L, "Sick Leave", false));
        List<ScheduleDay> days = week(RAVI, null);
        assertEquals(new Overlay(OverlayType.PH, "Diwali", false), days.get(0).overlay(), "PH over L");
        assertEquals(b.id(), days.get(0).shiftPolicyId(), "the planned shift stands underneath");
        assertEquals(OverlayType.L, days.get(1).overlay().type());
        assertTrue(days.get(1).overlay().halfDay());
        assertEquals(OverlayType.COFF, days.get(2).overlay().type());
        assertEquals(ScheduleKind.WO, days.get(5).kind(), "leave over a weekly off keeps the WO underneath");
        assertEquals(OverlayType.L, days.get(5).overlay().type());
    }

    @Test
    void theTeamViewNamesEachPersonOnceInTheOrderGiven() throws Exception {
        List<ScheduleDay> days = schedule.days(TENANT, List.of(new EffectiveSchedule.Person(SITA, "Sita Rao"),
                new EffectiveSchedule.Person(RAVI, "Ravi Kumar"), new EffectiveSchedule.Person(SITA, "Sita Rao")), MON, MON);
        assertEquals(List.of(SITA, RAVI), days.stream().map(ScheduleDay::employeeId).toList());
        assertEquals("Sita Rao", days.get(0).employeeName());
        String json = RosterFakes.JSON.writeValueAsString(week(RAVI, null).get(0));
        assertFalse(json.contains("employeeName"), "\"me\" leaves the name out: " + json);
        assertTrue(json.contains("\"date\":\"2026-10-12\""), json);
    }
}
