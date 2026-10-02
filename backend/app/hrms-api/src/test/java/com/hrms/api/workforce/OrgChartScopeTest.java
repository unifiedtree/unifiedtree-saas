package com.hrms.api.workforce;

import com.hrms.api.workforce.OrgChartScope.Link;
import com.hrms.api.workforce.OrgChartScope.Note;
import com.hrms.api.workforce.OrgChartScope.Placed;
import com.hrms.api.workforce.OrgChartScope.Relation;
import com.hrms.api.workforce.OrgChartScope.Result;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Who appears on the org chart and under whom: the company view (everyone
 * active in one company) and the team view (the viewer's line up to the top
 * and everyone below them), with the data mistakes real workspaces have:
 * people whose manager left or is in another company, people who report to
 * themselves, reporting loops, and very long chains.
 */
class OrgChartScopeTest {

    private static final UUID CO = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID OTHER_CO = UUID.fromString("cccccccc-0000-0000-0000-000000000002");

    private final Map<String, UUID> ids = new HashMap<>();
    private final List<Link> people = new ArrayList<>();

    private UUID id(String name) {
        return ids.computeIfAbsent(name, n -> UUID.nameUUIDFromBytes(n.getBytes()));
    }

    /** {@code name} reports to {@code manager} (null: nobody), in the main company. */
    private OrgChartScopeTest add(String name, String manager) {
        return add(name, manager, CO);
    }

    private OrgChartScopeTest add(String name, String manager, UUID company) {
        people.add(new Link(id(name), manager == null ? null : id(manager), company, name));
        return this;
    }

    private String nameOf(UUID u) {
        return ids.entrySet().stream().filter(e -> e.getValue().equals(u)).map(Map.Entry::getKey).findFirst().orElse("?");
    }

    private Map<String, String> parents(Result r) {
        Map<String, String> m = new HashMap<>();
        for (Placed p : r.people()) m.put(nameOf(p.id()), p.parentId() == null ? null : nameOf(p.parentId()));
        return m;
    }

    private Placed placed(Result r, String name) {
        return r.people().stream().filter(p -> p.id().equals(id(name))).findFirst().orElseThrow();
    }

    /** Every person once, and each one's parent listed before them. */
    private static void assertWellFormed(Result r) {
        Set<UUID> seen = new HashSet<>();
        for (Placed p : r.people()) {
            if (p.parentId() != null) assertThat(seen).as("parent listed before its report").contains(p.parentId());
            assertThat(seen.add(p.id())).as("each person once").isTrue();
        }
    }

    /** A small company: CEO → (CTO → Mgr → Reader, Mgr → Asha; CFO → Accountant). */
    private void company() {
        add("CEO", null).add("CTO", "CEO").add("CFO", "CEO").add("Mgr", "CTO")
                .add("Reader", "Mgr").add("Asha", "Mgr").add("Accountant", "CFO");
    }

    // ── company view ──────────────────────────────────────────────────────

    @Test
    void companyViewIsTheWholeTreeFromTheTopPersonDown() {
        company();
        Result r = OrgChartScope.company(people, CO);
        assertWellFormed(r);
        assertThat(r.truncated()).isFalse();
        Map<String, String> expected = new HashMap<>(Map.of(
                "CTO", "CEO", "CFO", "CEO", "Mgr", "CTO", "Reader", "Mgr", "Asha", "Mgr", "Accountant", "CFO"));
        expected.put("CEO", null);
        assertThat(parents(r)).isEqualTo(expected);
        assertThat(r.people().get(0).id()).isEqualTo(id("CEO"));
        assertThat(r.people()).allSatisfy(p -> assertThat(p.note()).isNull());
    }

    @Test
    void companyViewLeavesOutOtherCompaniesAndPeopleWhoAreNotActive() {
        company();
        add("Elsewhere", "CEO", OTHER_CO);
        // People who left are not passed in at all (the service reads active people only).
        Result r = OrgChartScope.company(people, CO);
        assertThat(parents(r)).doesNotContainKey("Elsewhere").hasSize(7);
        assertThat(OrgChartScope.company(people, OTHER_CO).people()).extracting(Placed::id).containsExactly(id("Elsewhere"));
    }

    @Test
    void someoneWhoseManagerIsNotOnTheChartHangsAtTheTopLevel() {
        company();
        add("Orphan", "Gone");                    // the manager left (not active) or never existed
        add("New joiner", null);                  // no manager set yet
        Result r = OrgChartScope.company(people, CO);
        assertWellFormed(r);
        assertThat(placed(r, "Orphan").parentId()).isNull();
        assertThat(placed(r, "Orphan").note()).isEqualTo(Note.MANAGER_NOT_SHOWN);
        assertThat(placed(r, "New joiner").parentId()).isNull();
        assertThat(placed(r, "New joiner").note()).isNull();
        assertThat(r.people()).hasSize(9);
    }

    @Test
    void aManagerInAnotherCompanyCountsAsNotOnTheChart() {
        add("Group CEO", null, OTHER_CO);
        add("Country head", "Group CEO").add("Sales", "Country head");
        Result r = OrgChartScope.company(people, CO);
        assertThat(placed(r, "Country head").parentId()).isNull();
        assertThat(placed(r, "Country head").note()).isEqualTo(Note.MANAGER_NOT_SHOWN);
        assertThat(placed(r, "Sales").parentId()).isEqualTo(id("Country head"));
    }

    @Test
    void someoneWhoReportsToThemselfHangsAtTheTopLevel() {
        company();
        add("Self", "Self").add("Under self", "Self");
        Result r = OrgChartScope.company(people, CO);
        assertWellFormed(r);
        assertThat(placed(r, "Self").parentId()).isNull();
        assertThat(placed(r, "Self").note()).isEqualTo(Note.CYCLE);
        assertThat(placed(r, "Under self").parentId()).isEqualTo(id("Self"));
    }

    @Test
    void aReportingLoopIsCutOnceAndNobodyIsLostOrRepeated() {
        company();
        // Bea → Abe → Cid → Bea, and Dee under Cid: nobody in it reaches the top.
        add("Abe", "Cid").add("Bea", "Abe").add("Cid", "Bea").add("Dee", "Cid");
        Result r = OrgChartScope.company(people, CO);
        assertWellFormed(r);
        assertThat(r.people()).hasSize(11);
        // Cut at the loop's first person by name (Abe), who hangs at the top level.
        assertThat(placed(r, "Abe").parentId()).isNull();
        assertThat(placed(r, "Abe").note()).isEqualTo(Note.CYCLE);
        assertThat(placed(r, "Cid").parentId()).isEqualTo(id("Bea"));
        assertThat(placed(r, "Bea").parentId()).isEqualTo(id("Abe"));
        assertThat(placed(r, "Dee").parentId()).isEqualTo(id("Cid"));
    }

    @Test
    void twoSeparateLoopsAreEachCut() {
        add("A1", "A2").add("A2", "A1").add("B1", "B2").add("B2", "B3").add("B3", "B1");
        Result r = OrgChartScope.company(people, CO);
        assertWellFormed(r);
        assertThat(r.people()).hasSize(5);
        assertThat(r.people().stream().filter(p -> p.parentId() == null).map(p -> nameOf(p.id()))).containsExactlyInAnyOrder("A1", "B1");
        assertThat(r.people().stream().filter(p -> p.note() == Note.CYCLE)).hasSize(2);
    }

    @Test
    void aVeryLongChainDoesNotOverflow() {
        add("P0", null);
        for (int i = 1; i < 20_000; i++) add("P" + i, "P" + (i - 1));
        Result r = OrgChartScope.company(people, CO);
        assertThat(r.truncated()).isTrue();
        assertThat(r.people()).hasSize(OrgChartScope.MAX_PEOPLE);
        assertWellFormed(r);
    }

    @Test
    void anEmptyCompanyIsAnEmptyChart() {
        assertThat(OrgChartScope.company(List.of(), CO).people()).isEmpty();
        company();
        assertThat(OrgChartScope.company(people, null).people()).isEmpty();
    }

    // ── team view ─────────────────────────────────────────────────────────

    @Test
    void anEmployeeSeesEveryoneAboveThemToTheTopAndNobodyUnrelated() {
        company();
        Result r = OrgChartScope.team(people, id("Reader"));
        assertWellFormed(r);
        assertThat(parents(r)).containsOnlyKeys("CEO", "CTO", "Mgr", "Reader");
        assertThat(parents(r)).containsEntry("CTO", "CEO").containsEntry("Mgr", "CTO").containsEntry("Reader", "Mgr");
        assertThat(placed(r, "CEO").parentId()).isNull();
        assertThat(placed(r, "CEO").relation()).isEqualTo(Relation.ABOVE);
        assertThat(placed(r, "Reader").relation()).isEqualTo(Relation.SELF);
        // Not the peer under the same manager, not the other branch of the company.
        assertThat(parents(r)).doesNotContainKeys("Asha", "CFO", "Accountant");
    }

    @Test
    void aManagerSeesTheirLineUpAndEveryoneBelowThem() {
        company();
        add("Intern", "Reader");
        Result r = OrgChartScope.team(people, id("Mgr"));
        assertWellFormed(r);
        assertThat(parents(r)).containsOnlyKeys("CEO", "CTO", "Mgr", "Reader", "Asha", "Intern");
        assertThat(placed(r, "Reader").relation()).isEqualTo(Relation.BELOW);
        assertThat(placed(r, "Intern").parentId()).isEqualTo(id("Reader"));
        assertThat(placed(r, "Intern").relation()).isEqualTo(Relation.BELOW);
        assertThat(placed(r, "CTO").relation()).isEqualTo(Relation.ABOVE);
    }

    @Test
    void theTopPersonSeesTheWholeTreeUnderThem() {
        company();
        Result r = OrgChartScope.team(people, id("CEO"));
        assertThat(r.people()).hasSize(7);
        assertThat(placed(r, "CEO").relation()).isEqualTo(Relation.SELF);
        assertThat(placed(r, "CEO").parentId()).isNull();
    }

    @Test
    void theTeamViewFollowsManagersInOtherCompaniesOfTheWorkspace() {
        add("Group CEO", null, OTHER_CO);
        add("Country head", "Group CEO").add("Sales", "Country head");
        Result r = OrgChartScope.team(people, id("Sales"));
        assertThat(parents(r)).containsEntry("Country head", "Group CEO").containsEntry("Sales", "Country head");
        assertThat(placed(r, "Group CEO").parentId()).isNull();
    }

    @Test
    void whenTheManagerHasLeftTheViewerIsTheTop() {
        add("Reader", "Gone").add("Report", "Reader");
        Result r = OrgChartScope.team(people, id("Reader"));
        assertThat(placed(r, "Reader").parentId()).isNull();
        assertThat(placed(r, "Reader").note()).isEqualTo(Note.MANAGER_NOT_SHOWN);
        assertThat(placed(r, "Report").parentId()).isEqualTo(id("Reader"));
    }

    @Test
    void aLoopThroughTheViewerStopsAtTheLastNewPerson() {
        // Reader → Mgr → Boss → Reader, and Kid under Reader.
        add("Reader", "Mgr").add("Mgr", "Boss").add("Boss", "Reader").add("Kid", "Reader");
        Result r = OrgChartScope.team(people, id("Reader"));
        assertWellFormed(r);
        assertThat(parents(r)).containsOnlyKeys("Boss", "Mgr", "Reader", "Kid");
        assertThat(placed(r, "Boss").parentId()).isNull();
        assertThat(placed(r, "Boss").note()).isEqualTo(Note.CYCLE);
        assertThat(placed(r, "Mgr").parentId()).isEqualTo(id("Boss"));
        // Boss reports to Reader too, but is drawn once, above.
        assertThat(placed(r, "Kid").parentId()).isEqualTo(id("Reader"));
    }

    @Test
    void aLoopElsewhereInTheWorkspaceIsNotOnSomeoneElsesChart() {
        // B and C report to each other; nobody in that loop is above or below Mgr.
        add("Mgr", null).add("A", "Mgr").add("B", "C").add("C", "B");
        Result r = OrgChartScope.team(people, id("Mgr"));
        assertWellFormed(r);
        assertThat(parents(r)).containsOnlyKeys("Mgr", "A");
        // B's own chart: B, then C above (the loop stops when it comes back round).
        Result b = OrgChartScope.team(people, id("B"));
        assertWellFormed(b);
        assertThat(parents(b)).containsOnlyKeys("B", "C");
        assertThat(placed(b, "C").parentId()).isNull();
        assertThat(placed(b, "C").note()).isEqualTo(Note.CYCLE);
    }

    @Test
    void someoneWhoReportsToThemselfIsTheirOwnTop() {
        add("Solo", "Solo").add("Under", "Solo");
        Result r = OrgChartScope.team(people, id("Solo"));
        assertThat(placed(r, "Solo").parentId()).isNull();
        assertThat(placed(r, "Solo").note()).isEqualTo(Note.CYCLE);
        assertThat(placed(r, "Under").parentId()).isEqualTo(id("Solo"));
    }

    @Test
    void theChainUpwardStopsAtTheSafetyLimit() {
        add("L0", null);
        for (int i = 1; i <= 100; i++) add("L" + i, "L" + (i - 1));
        Result r = OrgChartScope.team(people, id("L100"));
        assertWellFormed(r);
        assertThat(r.people()).hasSize(OrgChartScope.MAX_CHAIN + 1);
        Placed top = r.people().get(0);
        assertThat(top.parentId()).isNull();
        assertThat(top.note()).isEqualTo(Note.MANAGER_NOT_SHOWN);
    }

    @Test
    void noEmployeeRecordOrNotActiveMeansAnEmptyChart() {
        company();
        assertThat(OrgChartScope.team(people, null).people()).isEmpty();
        assertThat(OrgChartScope.team(people, UUID.randomUUID()).people()).isEmpty();
    }

    @Test
    void aHugeTeamIsCutShortAndSaysSo() {
        add("Boss", null);
        for (int i = 0; i < OrgChartScope.MAX_PEOPLE + 5; i++) add("R" + i, "Boss");
        Result r = OrgChartScope.team(people, id("Boss"));
        assertThat(r.truncated()).isTrue();
        assertThat(r.people()).hasSize(OrgChartScope.MAX_PEOPLE);
        assertWellFormed(r);
    }

    // ── counts ────────────────────────────────────────────────────────────

    @Test
    void directReportsAreCountedFromTheStoredManagerNotCountingThemself() {
        company();
        add("Self", "Self");
        Map<UUID, Integer> n = OrgChartScope.directReportCounts(people);
        assertThat(n.get(id("CEO"))).isEqualTo(2);
        assertThat(n.get(id("Mgr"))).isEqualTo(2);
        assertThat(n.get(id("CFO"))).isEqualTo(1);
        assertThat(n).doesNotContainKey(id("Reader")).doesNotContainKey(id("Self"));
    }
}
