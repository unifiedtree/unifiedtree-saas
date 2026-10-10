package com.hrms.api.roster;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.hrms.api.roster.RosterContract.*;
import com.hrms.api.roster.plan.PlanFacts;
import com.hrms.api.roster.plan.RosterPlanner;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The shift-planning JSON contract (design §1.5) keeps the names and shapes of
 * {@code apps/platform/src/modules/hrms/api/rosterTypes.ts}: request bodies written the way the web
 * writes them are read, and responses come out with exactly the TS field names. The mapper is set up
 * the way Spring Boot sets up the app's (ISO dates, unknown fields ignored).
 */
class RosterContractJsonTest {

    private final ObjectMapper json = JsonMapper.builder()
            .findAndAddModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    private static final UUID SHIFT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID EMP = UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Test
    void draftBodyAsTheWebSendsItIsRead() throws Exception {
        String body = """
            {"name":"October 2026 · Technical","periodType":"MONTH","startDate":"2026-10-01","endDate":"2026-10-31",
             "departmentId":null,"branchId":null,
             "config":{"templateId":null,"pattern":[{"shiftPolicyId":"%s","weeklyOff":false},{"shiftPolicyId":null,"weeklyOff":true}],
                       "repeats":true,"weeklyOffMode":"ROTATIONAL","staggerMode":"SPREAD","continueFromRosterId":null,
                       "shiftIds":["%s"],"designationIds":[""]},
             "members":[{"employeeId":"%s","rotationOffset":3}],
             "staffing":[],
             "rows":[{"employeeId":"%s","cells":["%s","WO",null],"edited":[1]}]}
            """.formatted(SHIFT, SHIFT, EMP, EMP, SHIFT);
        DraftBody d = json.readValue(body, DraftBody.class);
        assertEquals(PeriodType.MONTH, d.periodType());
        assertEquals(LocalDate.of(2026, 10, 31), d.endDate());
        assertNull(d.lockVersion(), "lockVersion is optional on create");
        assertEquals(WeeklyOffMode.ROTATIONAL, d.config().weeklyOffMode());
        assertEquals(List.of(""), d.config().designationIds(), "'' is the No designation bucket");
        assertTrue(d.config().pattern().get(1).weeklyOff());
        assertEquals(3, d.members().get(0).rotationOffset());
        assertEquals(java.util.Arrays.asList(SHIFT.toString(), RosterContract.WO, null), d.rows().get(0).cells());
        assertEquals(List.of(1), d.rows().get(0).edited());
    }

    @Test
    void optionalFieldsMayBeLeftOut() throws Exception {
        PublishBody p = json.readValue("{\"lockVersion\":4,\"acknowledgeWarnings\":true}", PublishBody.class);
        assertEquals(4, p.lockVersion());
        assertNull(p.note());
        TemplateBody t = json.readValue("{\"name\":\"AABBCCWO\",\"repeats\":true,\"days\":[]}", TemplateBody.class);
        assertNull(t.departmentId());
    }

    @Test
    void planResponseHasTheContractNames() throws Exception {
        Issue issue = new Issue("W4-1", IssueId.W4, Level.warning, EMP, List.of(LocalDate.of(2026, 10, 5)),
                SHIFT, null, "Praveen: 6 h rest between C on 5 Oct and A on 6 Oct.");
        PlanResponse plan = new PlanResponse(
                List.of(new PlanDay(LocalDate.of(2026, 10, 2), 5, "Gandhi Jayanti")),
                List.of(new PlanRow(EMP, "Praveen", "E001", null, null, "Technical", null, 0,
                        List.of(new PlanCell(SHIFT.toString(), "A", false,
                                new Overlay(OverlayType.PH, "Gandhi Jayanti", false), false, List.of("W4-1"))),
                        new RowTotals(1, 0, 1, 0, 0))),
                List.of(new CoverageRow(SHIFT, "A", null, List.of(new CoverageDay(null, 1, CoverageStatus.HOLIDAY)))),
                new Checks(List.of(), List.of(issue), List.of(),
                        List.of(new CheckSummary(IssueId.W4, Level.warning, 1, "1 employee has insufficient rest"))),
                List.of(new MemberIn(EMP, 0)));

        JsonNode n = json.readTree(json.writeValueAsString(plan));
        assertEquals(Set.of("days", "rows", "coverage", "checks", "members"), keys(n));
        assertEquals(Set.of("date", "weekday", "holidayName"), keys(n.at("/days/0")));
        assertEquals("2026-10-02", n.at("/days/0/date").asText());
        assertEquals(Set.of("employeeId", "employeeName", "employeeCode", "designationId", "designationName",
                "departmentName", "branchName", "rotationOffset", "cells", "totals"), keys(n.at("/rows/0")));
        assertEquals(Set.of("working", "weeklyOff", "holiday", "leave", "unplanned"), keys(n.at("/rows/0/totals")));
        assertEquals(Set.of("token", "code", "edited", "overlay", "outside", "issueIds"), keys(n.at("/rows/0/cells/0")));
        assertEquals("PH", n.at("/rows/0/cells/0/overlay/type").asText());
        assertEquals(Set.of("shiftPolicyId", "code", "designationId", "perDay"), keys(n.at("/coverage/0")));
        assertTrue(n.at("/coverage/0/perDay/0/required").isNull(), "null = no requirement, still sent");
        assertEquals("HOLIDAY", n.at("/coverage/0/perDay/0/status").asText());
        assertEquals(Set.of("key", "id", "level", "employeeId", "dates", "shiftPolicyId", "designationId", "message"),
                keys(n.at("/checks/warnings/0")));
        assertEquals("warning", n.at("/checks/warnings/0/level").asText(), "levels are lower case");
        assertEquals("W4", n.at("/checks/summary/0/id").asText());
    }

    @Test
    void rosterDetailHeaderIsTheSummaryPlusLockVersionAndConfig() throws Exception {
        Instant at = Instant.parse("2026-09-30T10:00:00Z");
        RosterSummary s = new RosterSummary(UUID.randomUUID(), UUID.randomUUID(), "October 2026", PeriodType.MONTH,
                LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31), null, null, null, null,
                RosterStatus.PUBLISHED, RosterSource.PLANNER, false, 2, 12, "HR Admin", at, "HR Admin", at, true, true);
        RosterHeader h = new RosterHeader(s.id(), s.companyId(), s.name(), s.periodType(), s.startDate(), s.endDate(),
                null, null, null, null, s.status(), s.source(), false, 2, 12, "HR Admin", at, "HR Admin", at,
                true, true, 7, new RosterConfig(null, List.of(), true, WeeklyOffMode.FIXED, StaggerMode.SAME,
                null, List.of(), List.of()));
        Set<String> summaryKeys = keys(json.readTree(json.writeValueAsString(s)));
        Set<String> headerKeys = keys(json.readTree(json.writeValueAsString(h)));
        Set<String> expected = new TreeSet<>(summaryKeys);
        expected.add("lockVersion");
        expected.add("config");
        assertEquals(expected, headerKeys);
        assertEquals("2026-09-30T10:00:00Z", json.readTree(json.writeValueAsString(s)).get("publishedAt").asText());
    }

    @Test
    void scheduleDayLeavesOutAMissingEmployeeName() throws Exception {
        ScheduleDay me = new ScheduleDay(EMP, null, LocalDate.of(2026, 10, 12), ScheduleKind.WO, null, "WO",
                null, null, null, false, ScheduleDaySource.ROSTER, UUID.randomUUID(), "October 2026", null);
        JsonNode n = json.readTree(json.writeValueAsString(me));
        assertFalse(n.has("employeeName"), "employeeName?: string — absent, not null");
        assertTrue(n.has("overlay") && n.get("overlay").isNull(), "overlay: null | {...} — sent as null");
        ScheduleDay team = new ScheduleDay(EMP, "Ravi Kumar", LocalDate.of(2026, 10, 12), ScheduleKind.SHIFT, SHIFT,
                "A", "Morning", "06:00", "14:00", false, ScheduleDaySource.BASELINE, null, null, null);
        assertEquals("Ravi Kumar", json.readTree(json.writeValueAsString(team)).get("employeeName").asText());
    }

    @Test
    void theStubsRefuseRatherThanGuess() {
        assertThrows(UnsupportedOperationException.class, () -> RosterPlanner.plan(null, new PlanFacts()));
        assertThrows(UnsupportedOperationException.class, () -> new BaselineScheduleAdapter()
                .between(UUID.randomUUID(), List.of(EMP), LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31)));
    }

    private static Set<String> keys(JsonNode n) {
        Set<String> out = new TreeSet<>();
        n.fieldNames().forEachRemaining(out::add);
        return out;
    }
}
