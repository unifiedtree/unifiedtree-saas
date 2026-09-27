package com.hrms.api.ess.needs;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.probation.ProbationService;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.support.TransactionOperations;

import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * BW-120 "Needs you": each source only behind the permission of the page it
 * links to, a missing table takes out only its own source, and the rules that
 * decide what shows (the fix window, the open night shift, groups, probation
 * window) hold.
 */
class NeedsYouServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID ME = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 27);

    private TenantModuleLookup modules;
    private EssSourceRunner runner;
    private JdbcTemplate jdbc;

    @BeforeEach
    void wire() {
        modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), any())).thenReturn(true);
        runner = new EssSourceRunner(modules, TransactionOperations.withoutTransaction());
        jdbc = mock(JdbcTemplate.class);
    }

    private static EssCaller caller(String... perms) {
        return new EssCaller(TENANT, ME, Set.of(perms), null, TODAY);
    }

    /** Every JDBC-backed source, as Spring wires them. */
    private List<NeedsYouSource> jdbcSources() {
        return List.of(new MissedPunchOutSource(jdbc), new DocumentsToRedoSource(jdbc), new MissingDocumentsSource(jdbc),
                new OnboardingTasksSource(jdbc), new InterviewScorecardsSource(jdbc), new SelfReviewSource(jdbc),
                new ReviewsToWriteSource(jdbc), new PoliciesToAcceptSource(jdbc));
    }

    // ── gating ───────────────────────────────────────────────────────────────

    @Test void eachSourceOpensOnlyWithThePermissionOfItsPage() {
        List<NeedsYouSource> all = new ArrayList<>(jdbcSources());
        all.add(new ProbationDecisionsSource(null, null, null));
        String[][] expected = {
                {"MISSED_PUNCH_OUT", "attendance", "attendance.checkin.self"},
                {"DOCUMENT_REDO", "hrms", "hrms.document.read.self"},
                {"DOCUMENT_MISSING", "hrms", "hrms.document.type.read,hrms.document.read.self"},
                {"ONBOARDING_TASK", "hrms", "hrms.onboarding.task.complete,hrms.onboarding.instance.read"},
                {"INTERVIEW_SCORECARD", "hrms", "hrms.hiring.interview.self"},
                {"SELF_REVIEW", "hrms", "hrms.performance.review.self"},
                {"REVIEWS_TO_WRITE", "hrms", "hrms.performance.review.self"},
                {"POLICY_TO_ACCEPT", "hrms", "hrms.policy.acknowledge.self"},
                {"PROBATION_DECISION", "hrms", "hrms.probation.team.decide"}};
        for (int i = 0; i < all.size(); i++) {
            NeedsYouSource s = all.get(i);
            assertEquals(expected[i][0], s.key());
            assertEquals(expected[i][1], s.module(), s.key());
            String[] needed = expected[i][2].split(",");
            assertTrue(s.allowed(caller(needed)), s.key());
            assertFalse(s.allowed(caller("hrms.ess.read", "attendance.team.read", "hrms.employee.read")), s.key() + ": not with unrelated permissions");
            if (needed.length > 1) {
                assertFalse(s.allowed(caller(needed[0])), s.key() + ": both permissions are needed");
                assertFalse(s.allowed(caller(needed[1])), s.key() + ": both permissions are needed");
            }
        }
        assertTrue(new InterviewScorecardsSource(jdbc).allowed(caller("hrms.hiring.read")), "the interviews page's other permission");
    }

    @Test void aSourceTheCallerMayNotSeeIsNeverRead() {
        NeedsYouItem.Response r = new NeedsYouService(jdbcSources(), runner).needsYou(caller("hrms.ess.read"));
        assertTrue(r.items().isEmpty());
        assertTrue(r.included().isEmpty());
        assertTrue(r.unavailable().isEmpty());
        verifyNoInteractions(jdbc);
    }

    @Test void aMissingTableTakesOutOnlyItsOwnSource() {
        BadSqlGrammarException missing = new BadSqlGrammarException("q", "SELECT … FROM hiring_mgmt.interviews",
                new SQLException("relation \"hiring_mgmt.interviews\" does not exist", "42P01"));
        when(jdbc.query(contains("hiring_mgmt.interviews"), any(RowMapper.class), any(Object[].class))).thenThrow(missing);
        when(jdbc.query(contains("policy_mgmt.hr_policies"), any(RowMapper.class), any(Object[].class)))
                .thenReturn(List.of(new NeedsYouItem("POLICY_TO_ACCEPT", "Accept Code of conduct", null, null, null,
                        NeedsYouItem.BRAND, UUID.randomUUID(), 1, "/hrms/policies")));
        NeedsYouItem.Response r = new NeedsYouService(jdbcSources(), runner)
                .needsYou(caller("hrms.hiring.interview.self", "hrms.policy.acknowledge.self"));
        assertEquals(List.of("INTERVIEW_SCORECARD"), r.unavailable());
        assertEquals(List.of("POLICY_TO_ACCEPT"), r.included());
        assertEquals(1, r.count());
    }

    @Test void aModuleThatIsOffSkipsItsSources() {
        when(modules.hasActiveModule(TENANT, "attendance")).thenReturn(false);
        NeedsYouItem.Response r = new NeedsYouService(jdbcSources(), runner).needsYou(caller("attendance.checkin.self"));
        assertTrue(r.included().isEmpty());
        verifyNoInteractions(jdbc);
    }

    @Test void aLoginWithoutAnEmployeeRecordHasNothing() {
        EssCaller none = new EssCaller(TENANT, null, Set.of("attendance.checkin.self"), null, TODAY);
        assertTrue(new NeedsYouService(jdbcSources(), runner).needsYou(none).items().isEmpty());
        verifyNoInteractions(jdbc);
    }

    // ── what shows ───────────────────────────────────────────────────────────

    @Test void missedPunchOutsUseTheFixWindowAndLeaveAnOpenNightShiftAlone() {
        MissedPunchOutSource s = new MissedPunchOutSource(jdbc);
        s.clock = Clock.fixed(Instant.parse("2026-09-27T06:00:00Z"), ZoneOffset.UTC);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        s.load(caller("attendance.checkin.self"));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(RowMapper.class), eq(TENANT), eq(ME), eq(TODAY.minusDays(90)), eq(TODAY),
                eq(Timestamp.from(Instant.parse("2026-09-26T10:00:00Z"))), eq(10));
        assertTrue(sql.getValue().contains("r.check_out_at IS NULL"));
        assertTrue(sql.getValue().contains("c.status IN ('PENDING', 'APPROVED')"), "a waiting or approved fix hides the day");
    }

    @Test void missingDocumentsAreOneRowThatCountsEachDocument() {
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class)))
                .thenReturn(List.of("PAN Card", "Aadhaar Card", "Passport-size Photograph"));
        List<NeedsYouItem> out = new MissingDocumentsSource(jdbc).load(caller());
        assertEquals(1, out.size());
        assertEquals("Upload 3 documents", out.get(0).title());
        assertEquals("PAN Card, Aadhaar Card and Passport-size Photograph", out.get(0).detail());
        assertEquals(3, out.get(0).count());
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class))).thenReturn(List.of("PAN Card"));
        assertEquals("Upload your PAN Card", new MissingDocumentsSource(jdbc).load(caller()).get(0).title());
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class))).thenReturn(List.of());
        assertTrue(new MissingDocumentsSource(jdbc).load(caller()).isEmpty());
    }

    @Test void everyQueryReadsOnlyTheCallersOwnWorkspace() {
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class))).thenReturn(List.of());
        for (NeedsYouSource s : jdbcSources()) s.load(caller());
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, atLeastOnce()).query(sql.capture(), any(RowMapper.class), any(Object[].class));
        verify(jdbc).queryForList(sql.capture(), eq(String.class), any(Object[].class));
        assertEquals(8, sql.getAllValues().size());
        for (String q : sql.getAllValues()) assertTrue(q.matches("(?s).*WHERE \\w+\\.tenant_id = \\?.*"), q);
    }

    @Test void theProbationWindowIsTheWorkspacesReminderWindowAndOverdueIsRed() {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        EmployeeRepository employees = mock(EmployeeRepository.class);
        ProbationService probation = mock(ProbationService.class);
        Employee me = new Employee();
        me.setId(ME);
        when(employees.findById(ME)).thenReturn(Optional.of(me));
        when(probation.getConfig(TENANT)).thenReturn(new ProbationService.ProbationConfigDto(7, false, 90));
        when(scope.teamOf(me)).thenReturn(List.of(
                person("Aditya", EmploymentStatus.PROBATION, TODAY.plusDays(7)),   // last day of the window
                person("Rohit", EmploymentStatus.PROBATION, TODAY.plusDays(8)),    // not yet
                person("Old", EmploymentStatus.PROBATION, TODAY.minusDays(2)),     // overdue
                person("Sita", EmploymentStatus.ACTIVE, TODAY.plusDays(1))));      // already confirmed
        List<NeedsYouItem> out = new ProbationDecisionsSource(scope, employees, probation).load(caller("hrms.probation.team.decide"));
        assertEquals(List.of("Decide on Old Rao’s probation", "Decide on Aditya Rao’s probation"), out.stream().map(NeedsYouItem::title).toList());
        assertEquals(NeedsYouItem.BAD, out.get(0).tone());
        assertEquals(NeedsYouItem.GOLD, out.get(1).tone());
        assertEquals(TODAY.plusDays(7), out.get(1).dueDate());
        assertEquals("/team", out.get(1).link());
    }

    @Test void redItemsComeFirstThenBySoonestDue() {
        NeedsYouSource fake = new NeedsYouSource() {
            @Override public String key() { return "FAKE"; }
            @Override public String module() { return null; }
            @Override public boolean allowed(EssCaller caller) { return true; }
            @Override public List<NeedsYouItem> load(EssCaller caller) {
                return List.of(
                        new NeedsYouItem("POLICY_TO_ACCEPT", "brand", null, null, null, NeedsYouItem.BRAND, null, 1, "/"),
                        new NeedsYouItem("ONBOARDING_TASK", "gold later", null, null, TODAY.plusDays(9), NeedsYouItem.GOLD, null, 1, "/"),
                        new NeedsYouItem("MISSED_PUNCH_OUT", "bad", null, TODAY.minusDays(3), null, NeedsYouItem.BAD, null, 1, "/"),
                        new NeedsYouItem("PROBATION_DECISION", "gold sooner", null, null, TODAY.plusDays(2), NeedsYouItem.GOLD, null, 1, "/"),
                        new NeedsYouItem("REVIEWS_TO_WRITE", "blue", null, null, null, NeedsYouItem.BLUE, null, 3, "/"));
            }
        };
        NeedsYouItem.Response r = new NeedsYouService(List.of(fake), runner).needsYou(caller());
        assertEquals(List.of("bad", "gold sooner", "gold later", "blue", "brand"), r.items().stream().map(NeedsYouItem::title).toList());
        assertEquals(7, r.count(), "a grouped row counts each thing in it");
    }

    private static Employee person(String first, EmploymentStatus status, LocalDate end) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setTenantId(TENANT);
        e.setFirstName(first);
        e.setLastName("Rao");
        e.setEmploymentStatus(status);
        e.setProbationEndDate(end);
        return e;
    }
}
