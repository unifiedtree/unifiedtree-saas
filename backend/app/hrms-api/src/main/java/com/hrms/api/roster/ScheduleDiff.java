package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterStore.Cell;
import com.hrms.api.roster.RosterStore.Day;
import com.hrms.api.roster.RosterStore.DayChange;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * What a publish changes in the published schedule (design §1.5 "Publish", step 5): the working copy's
 * days against the roster's own published days, both from today on. A day only in the working copy is
 * ADDED, one in both with another value is CHANGED, one only published is REMOVED (its cell was
 * cleared, or its person left the roster). Pure: no database.
 */
final class ScheduleDiff {

    private ScheduleDiff() {}

    record Key(UUID employeeId, LocalDate date) {}

    static List<DayChange> between(Collection<Cell> desired, Collection<Day> existing) {
        Map<Key, Cell> want = new LinkedHashMap<>();
        for (Cell c : desired) want.put(new Key(c.employeeId(), c.date()), c);
        Map<Key, Day> have = new LinkedHashMap<>();
        for (Day d : existing) have.put(new Key(d.employeeId(), d.date()), d);
        List<DayChange> out = new ArrayList<>();
        for (Map.Entry<Key, Day> e : have.entrySet()) {
            Day d = e.getValue();
            Cell c = want.get(e.getKey());
            if (c == null) {
                out.add(new DayChange(d.employeeId(), d.date(), ChangeKind.REMOVED, d.kind(), d.shiftPolicyId(), null, null));
            } else if (!Objects.equals(c.kind(), d.kind()) || !Objects.equals(c.shiftPolicyId(), d.shiftPolicyId())) {
                out.add(new DayChange(d.employeeId(), d.date(), ChangeKind.CHANGED, d.kind(), d.shiftPolicyId(), c.kind(), c.shiftPolicyId()));
            }
        }
        for (Map.Entry<Key, Cell> e : want.entrySet()) {
            if (have.containsKey(e.getKey())) continue;
            Cell c = e.getValue();
            out.add(new DayChange(c.employeeId(), c.date(), ChangeKind.ADDED, null, null, c.kind(), c.shiftPolicyId()));
        }
        out.sort(Comparator.comparing((DayChange c) -> c.employeeId().toString()).thenComparing(DayChange::date));
        return out;
    }

    private static final DateTimeFormatter DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d", Locale.ENGLISH);

    /** "3–5 Oct, 9 Oct", "30 Sep–2 Oct": runs of consecutive dates, in order. */
    static String dates(Collection<LocalDate> in) {
        List<LocalDate> ds = in.stream().distinct().sorted().toList();
        List<String> parts = new ArrayList<>();
        for (int i = 0; i < ds.size(); ) {
            int j = i;
            while (j + 1 < ds.size() && ds.get(j + 1).equals(ds.get(j).plusDays(1))) j++;
            LocalDate a = ds.get(i), b = ds.get(j);
            if (a.equals(b)) parts.add(a.format(DAY_MONTH));
            else if (a.getMonth() == b.getMonth() && a.getYear() == b.getYear()) parts.add(a.format(DAY) + "–" + b.format(DAY_MONTH));
            else parts.add(a.format(DAY_MONTH) + "–" + b.format(DAY_MONTH));
            i = j + 1;
        }
        return String.join(", ", parts);
    }
}
