package com.hrms.api.approvals;

import com.hrms.api.attendance.ShiftCharacterizationFixture;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Characterization of the approvals inbox's "On <shift> now" count on a shift change (shift-ot GAP-MAP §2.2), on
 * {@link ShiftCharacterizationFixture}'s data, written before the shift lookups were replaced by one resolver. Unlike
 * every other copy it picks no "latest" row: each assignment of the tenant covering the day counts, so a person with
 * two overlapping rows is counted on both shifts, and an archived shift is counted too.
 *
 * <p>Opt-in: only against a migrated, disposable database (RECOVERY_TEST_JDBC_URL). Everything is deleted afterwards.
 */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class InboxShiftCountCharacterizationSqlTest {

    private final ShiftCharacterizationFixture f = new ShiftCharacterizationFixture();

    @BeforeEach void seed() {
        TenantContext.setTenantId(f.tenant);
        f.seed();
    }

    @AfterEach void cleanup() {
        try {
            f.cleanup();
        } finally {
            TenantContext.clear();
        }
    }

    private InboxQueries.Row request(String shiftLabel, UUID shift, LocalDate from) {
        InboxQueries.Row r = new InboxQueries.Row(DecisionKind.SHIFT_CHANGE, UUID.randomUUID(), f.id("E1"), "E1", "QAS-1",
                null, Instant.parse("2026-08-01T00:00:00Z"), "Shift change", from, null, null, null, null, "Reason");
        r.extra.put("requestedId", shift);
        r.extra.put("requestedName", shiftLabel);
        r.extra.put("start", LocalTime.of(9, 0));
        r.extra.put("end", LocalTime.of(18, 0));
        return r;
    }

    @Test void peopleOnTheRequestedShift() throws Exception {
        Map<String, UUID> shifts = new java.util.LinkedHashMap<>();
        shifts.put("GENERAL", f.general);
        shifts.put("NIGHT", f.night);
        shifts.put("FLEX", f.flex);
        shifts.put("ARCHIVED", f.archived);
        shifts.put("B_SHIFT", f.bShift);
        shifts.put("X_SHIFT", f.xShift);
        InboxQueries queries = new InboxQueries(f.jdbc);
        StringBuilder out = new StringBuilder();
        for (LocalDate today : List.of(LocalDate.of(2026, 8, 4), LocalDate.of(2026, 8, 5), LocalDate.of(2026, 8, 10))) {
            for (boolean wholeTeam : new boolean[]{true, false}) {
                List<InboxQueries.Row> rows = new ArrayList<>();
                shifts.forEach((label, id) -> rows.add(request(label, id, LocalDate.of(2026, 8, 20))));
                // The caller's team: everyone, or only the first six people.
                List<UUID> team = wholeTeam ? f.everyoneBut() : f.ids("E1", "E2", "E3", "E4", "E5", "E6");
                queries.enrichShiftChanges(f.tenant, rows, new HashSet<>(team), today);
                for (InboxQueries.Row r : rows) {
                    out.append(today).append(wholeTeam ? " team=all " : " team=E1-E6 ").append(r.extra.get("requestedName"))
                            .append(" facts=").append(r.facts).append(" warnings=").append(r.warnings).append('\n');
                }
            }
        }
        ShiftCharacterizationFixture.assertGolden("inbox-people-on-shift.txt", f.labelled(out.toString()));
        // On 5 Aug General has E1, E2, E3, E4, E10, E11 and E12 (E9's ended the day before). E3 is on Flex too, E4 on
        // the archived shift too, and E12 on the other tenant's shift too; E11's row of the other tenant isn't seen.
        List<InboxQueries.Row> rows = new ArrayList<>();
        shifts.forEach((label, id) -> rows.add(request(label, id, LocalDate.of(2026, 8, 20))));
        queries.enrichShiftChanges(f.tenant, rows, new HashSet<>(f.everyoneBut()), LocalDate.of(2026, 8, 5));
        assertEquals("7 people", value(rows.get(0)));
        assertEquals("2 people", value(rows.get(2)));
        assertEquals("1 person", value(rows.get(3)));
        assertEquals("1 person", value(rows.get(5)));
    }

    private static String value(InboxQueries.Row r) {
        return r.facts.stream().filter(x -> "onNewShift".equals(x.key())).findFirst().orElseThrow().value();
    }
}
