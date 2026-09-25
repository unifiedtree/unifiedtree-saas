package com.hrms.app.reports;

import com.hrms.attendance.policy.EffectiveDay;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The attendance summary and late-marks reports count late days from the
 * effective status (w1a hook, wave-2 integration), not the stored LATE flag.
 */
class ReportEffectiveStatusTest {

    private static final LocalDate D1 = LocalDate.of(2026, 9, 1), D2 = D1.plusDays(1), D3 = D1.plusDays(2);

    private static EffectiveDay eff(UUID emp, LocalDate d, String status, Integer lateMinutes, boolean rejected) {
        return new EffectiveDay(emp, d, status, status, null, null, null, lateMinutes, null, false, null, false, null, null,
                null, false, 1.0, false, null, null, null, null, rejected, false, null, null, null, null, 15, null);
    }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void summaryCountsEffectiveLateAndWorkedDays() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        List<Map<String, Object>> rows = new ArrayList<>(List.of(
                row("employee_id", a, "employee_code", "E1", "present_days", 3L, "late_days", 3L),
                row("employee_id", b, "employee_code", "E2", "present_days", 2L, "late_days", 0L)));
        Map<UUID, Map<LocalDate, EffectiveDay>> effective = Map.of(
                // a: 3 stored LATE; one inside the allowance (present), one excused (present), one late.
                a, Map.of(D1, eff(a, D1, EffectiveDay.PRESENT, 20, false), D2, eff(a, D2, EffectiveDay.PRESENT, null, false),
                        D3, eff(a, D3, EffectiveDay.LATE, 40, false)),
                // b: 2 stored ON_TIME; the policy's earlier start makes both late; one face punch rejected.
                b, Map.of(D1, eff(b, D1, EffectiveDay.LATE, 10, false), D2, eff(b, D2, EffectiveDay.LATE, 12, false),
                        D3, eff(b, D3, EffectiveDay.ABSENT, null, true)));

        ReportService.applyEffectiveSummary(rows, effective);

        assertEquals("E2", rows.get(0).get("employee_code"), "re-sorted by late days");
        assertEquals(2L, rows.get(0).get("late_days"));
        assertEquals(2L, rows.get(0).get("present_days"), "the rejected punch doesn't count as present");
        assertEquals(1L, rows.get(1).get("late_days"));
        assertEquals(3L, rows.get(1).get("present_days"));
        assertFalse(rows.get(0).containsKey("employee_id"), "the helper column is dropped");
    }

    @Test
    void summaryWithoutThePolicyServiceIsUnchanged() {
        UUID a = UUID.randomUUID();
        List<Map<String, Object>> rows = new ArrayList<>(List.of(row("employee_id", a, "present_days", 3L, "late_days", 2L)));
        ReportService.applyEffectiveSummary(rows, Map.of());
        assertEquals(2L, rows.get(0).get("late_days"));
        assertEquals(3L, rows.get(0).get("present_days"));
        assertFalse(rows.get(0).containsKey("employee_id"));
    }

    @Test
    void lateMarksKeepOnlyEffectivelyLateDays() {
        UUID a = UUID.randomUUID();
        List<Map<String, Object>> rows = new ArrayList<>(List.of(
                row("employee_id", a, "attendance_date", java.sql.Date.valueOf(D1), "late_by_minutes", 20),
                row("employee_id", a, "attendance_date", java.sql.Date.valueOf(D2), "late_by_minutes", null),
                row("employee_id", a, "attendance_date", java.sql.Date.valueOf(D3), "late_by_minutes", 5)));
        Map<UUID, Map<LocalDate, EffectiveDay>> effective = Map.of(a, Map.of(
                D1, eff(a, D1, EffectiveDay.PRESENT, 20, false),    // inside the allowance: not a late mark
                D2, eff(a, D2, EffectiveDay.LATE, 25, false),       // ON_TIME record, late under the policy
                D3, eff(a, D3, EffectiveDay.LATE, 35, false)));

        List<Map<String, Object>> out = ReportService.effectiveLateRows(rows, effective);

        assertEquals(2, out.size());
        assertEquals(35, out.get(0).get("late_by_minutes"), "the policy's late minutes, longest first");
        assertEquals(25, out.get(1).get("late_by_minutes"));
        assertFalse(out.get(0).containsKey("employee_id"));
    }
}
