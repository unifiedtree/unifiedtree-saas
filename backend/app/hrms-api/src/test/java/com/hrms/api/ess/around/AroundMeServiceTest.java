package com.hrms.api.ess.around;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.support.TransactionOperations;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * BW-121 "Around you": the window is today to N days ahead (both ends in),
 * yearly dates roll across the year end, the list is in date order, notices
 * read their event date only when the column exists, and team probation ends
 * are only for team approvers and only their team.
 */
class AroundMeServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 12, 28);

    private Employee me;
    private EmployeeRepository employees;
    private TenantModuleLookup modules;
    private EssSourceRunner runner;

    @BeforeEach
    void wire() {
        me = new Employee();
        me.setId(UUID.randomUUID());
        me.setTenantId(TENANT);
        me.setCompanyId(COMPANY);
        employees = mock(EmployeeRepository.class);
        when(employees.findById(me.getId())).thenReturn(Optional.of(me));
        modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), any())).thenReturn(true);
        runner = new EssSourceRunner(modules, TransactionOperations.withoutTransaction());
    }

    private EssCaller caller(String... perms) {
        return new EssCaller(TENANT, me.getId(), Set.of(perms), null, TODAY);
    }

    private static AroundItem item(String kind, LocalDate date, String title) {
        return new AroundItem(kind, date, "ON", title, null, null, UUID.randomUUID(), null, null, null, null);
    }

    /** A stand-in source returning fixed items and recording the window it was asked for. */
    private static final class Fake implements AroundSource {
        final String key; final List<AroundItem> items; LocalDate from, to;
        Fake(String key, List<AroundItem> items) { this.key = key; this.items = items; }
        @Override public String key() { return key; }
        @Override public String module() { return null; }
        @Override public boolean allowed(EssCaller caller) { return true; }
        @Override public List<AroundItem> load(EssCaller caller, Employee e, LocalDate f, LocalDate t) { from = f; to = t; return items; }
    }

    @Test void theWindowIsTodayToDaysAheadClamped() {
        assertArrayEquals(new LocalDate[] {TODAY, TODAY.plusDays(14)}, AroundMeService.window(TODAY, null));
        assertArrayEquals(new LocalDate[] {TODAY, TODAY.plusDays(1)}, AroundMeService.window(TODAY, 0));
        assertArrayEquals(new LocalDate[] {TODAY, TODAY.plusDays(60)}, AroundMeService.window(TODAY, 400));
        Fake f = new Fake("HOLIDAY", List.of());
        AroundItem.Response r = new AroundMeService(List.of(f), runner, employees).aroundMe(caller(), 7);
        assertEquals(TODAY, f.from);
        assertEquals(TODAY.plusDays(7), f.to);
        assertEquals(TODAY, r.from());
        assertEquals(TODAY.plusDays(7), r.to());
    }

    @Test void itemsAreInDateOrderThenByKind() {
        LocalDate d1 = TODAY.plusDays(1), d2 = TODAY.plusDays(2);
        Fake people = new Fake("BIRTHDAY", List.of(item("BIRTHDAY", d2, "Zoya’s birthday"), item("BIRTHDAY", d1, "Kavya’s birthday")));
        Fake holidays = new Fake("HOLIDAY", List.of(item("HOLIDAY", d2, "Gandhi Jayanti")));
        Fake pay = new Fake("PAYDAY", List.of(item("PAYDAY", d2, "Payday")));
        AroundItem.Response r = new AroundMeService(List.of(people, holidays, pay), runner, employees).aroundMe(caller(), null);
        assertEquals(List.of("Kavya’s birthday", "Payday", "Gandhi Jayanti", "Zoya’s birthday"),
                r.items().stream().map(AroundItem::title).toList());
    }

    @Test void aLoginWithoutAnEmployeeRecordGetsAnEmptyWindow() {
        EssCaller none = new EssCaller(TENANT, null, Set.of(), null, TODAY);
        Fake f = new Fake("HOLIDAY", List.of(item("HOLIDAY", TODAY, "x")));
        AroundItem.Response r = new AroundMeService(List.of(f), runner, employees).aroundMe(none, null);
        assertTrue(r.items().isEmpty());
        assertNull(f.from, "nothing is read");
    }

    // ── yearly dates ─────────────────────────────────────────────────────────

    @Test void birthdaysRollAcrossTheYearEndAndTheEdgesAreIncluded() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID(), c = UUID.randomUUID(), d = UUID.randomUUID();
        List<YearlyDates.Person> people = List.of(
                new YearlyDates.Person(a, "Asha", "Eng", LocalDate.of(1990, 1, 3)),    // next year, inside
                new YearlyDates.Person(b, "Bala", null, LocalDate.of(1991, 12, 28)),  // today (first day)
                new YearlyDates.Person(c, "Chitra", "Ops", LocalDate.of(1992, 1, 11)),  // last day (today + 14)
                new YearlyDates.Person(d, "Dev", "Ops", LocalDate.of(1993, 1, 12)));    // one past the window
        List<YearlyDates.Occurrence> in = YearlyDates.within(people, TODAY, TODAY.plusDays(14));
        assertEquals(List.of(a, b, c), in.stream().map(o -> o.person().id()).toList());
        assertEquals(LocalDate.of(2027, 1, 3), in.get(0).on());
    }

    @Test void aLeapDayBirthdayFallsOnThe28thAndTheJoiningYearIsNoAnniversary() {
        LocalDate feb = LocalDate.of(2027, 2, 20);
        List<YearlyDates.Occurrence> leap = YearlyDates.within(
                List.of(new YearlyDates.Person(UUID.randomUUID(), "Leap", null, LocalDate.of(2000, 2, 29))), feb, feb.plusDays(14));
        assertEquals(LocalDate.of(2027, 2, 28), leap.get(0).on());
        assertTrue(YearlyDates.within(List.of(new YearlyDates.Person(UUID.randomUUID(), "New", null, TODAY.minusDays(2).plusYears(0))),
                TODAY, TODAY.plusDays(14)).isEmpty(), "joined two days ago: no anniversary this year");
        List<YearlyDates.Occurrence> third = YearlyDates.within(
                List.of(new YearlyDates.Person(UUID.randomUUID(), "Old", null, LocalDate.of(2024, 1, 2))), TODAY, TODAY.plusDays(14));
        assertEquals(3, third.get(0).years());
    }

    @Test void birthdaysAndAnniversariesAreReadForTheCallersCompanyOnly() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any())).thenReturn(List.of());
        new BirthdaysSource(jdbc, null).load(caller(), me, TODAY, TODAY.plusDays(14));
        new WorkAnniversariesSource(jdbc).load(caller(), me, TODAY, TODAY.plusDays(14));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(2)).query(sql.capture(), any(RowMapper.class), eq(TENANT), eq(COMPANY));
        assertTrue(sql.getAllValues().get(0).contains("e.date_of_birth"));
        assertTrue(sql.getAllValues().get(1).contains("e.date_of_joining"));
        for (String q : sql.getAllValues()) assertTrue(q.contains("e.tenant_id = ? AND e.company_id = ? AND e.is_active"), q);
        assertThrows(IllegalArgumentException.class, () -> YearlyDates.people(jdbc, "salary", TENANT, COMPANY));
    }

    @Test void aCompanyThatHidesBirthdaysHasNoneAroundYou() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        com.hrms.api.settings.CelebrationSettingService settings = mock(com.hrms.api.settings.CelebrationSettingService.class);
        when(settings.showBirthdays(TENANT, COMPANY)).thenReturn(false);
        assertTrue(new BirthdaysSource(jdbc, settings).load(caller(), me, TODAY, TODAY.plusDays(14)).isEmpty());
        verify(jdbc, never()).query(anyString(), any(RowMapper.class), any(), any());
        when(settings.showBirthdays(TENANT, COMPANY)).thenReturn(true);
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any()))
                .thenReturn(List.of(new YearlyDates.Person(UUID.randomUUID(), "Kavya", null, TODAY.minusYears(30))));
        assertEquals(1, new BirthdaysSource(jdbc, settings).load(caller(), me, TODAY, TODAY.plusDays(14)).size());
    }

    // ── holidays, payday, notices ────────────────────────────────────────────

    @Test void holidaysAndPaydayUseTheWindowAndTheCompany() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any(), any())).thenReturn(List.of());
        LocalDate to = TODAY.plusDays(14);
        new HolidaysSource(jdbc).load(caller(), me, TODAY, to);
        new PaydaySource(jdbc).load(caller(), me, TODAY, to);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(2)).query(sql.capture(), any(RowMapper.class), eq(TENANT), eq(COMPANY), eq(TODAY), eq(to));
        assertTrue(sql.getAllValues().get(0).contains("h.is_active") && sql.getAllValues().get(0).contains("BETWEEN ? AND ?"));
        assertTrue(sql.getAllValues().get(1).contains("r.status <> 'CANCELLED'") && sql.getAllValues().get(1).contains("r.pay_date BETWEEN ? AND ?"));
        assertEquals("National holiday", HolidaysSource.TYPE_LABELS.get("NATIONAL"));
    }

    @Test void paydayNeedsOwnPayslipsAndTheProbationEndsNeedATeamPermission() {
        assertFalse(new PaydaySource(null).allowed(caller("hrms.ess.read")));
        assertTrue(new PaydaySource(null).allowed(caller("payroll.payslip.read.self")));
        assertEquals("payroll", new PaydaySource(null).module());
        TeamProbationEndsSource team = new TeamProbationEndsSource(null, null);
        assertFalse(team.allowed(caller("hrms.ess.read", "attendance.checkin.self")));
        assertTrue(team.allowed(caller("attendance.team.read")));
        assertTrue(team.allowed(caller("hrms.leave.approve.l1")));
    }

    @Test void noticesReadTheEventDateOnlyWhenTheColumnExists() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        NoticesSource notices = spy(new NoticesSource(jdbc));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);

        doReturn(false).when(notices).hasEventDate();
        notices.load(caller(), me, TODAY, TODAY.plusDays(14));
        doReturn(true).when(notices).hasEventDate();
        notices.load(caller(), me, TODAY, TODAY.plusDays(14));
        verify(jdbc, times(2)).query(sql.capture(), any(RowMapper.class), any(Object[].class));
        assertFalse(sql.getAllValues().get(0).contains("n.event_date"), "no column yet: never named");
        assertTrue(sql.getAllValues().get(0).contains("NOT n.archived"));
        assertTrue(sql.getAllValues().get(1).contains("n.event_date BETWEEN ? AND ?"));
        assertEquals("Short body", NoticesSource.excerpt("  Short\n body "));
        String longBody = "word ".repeat(100);
        String cut = NoticesSource.excerpt(longBody);
        assertTrue(cut.endsWith("…") && cut.length() <= NoticesSource.DETAIL_CHARS + 1, cut);
    }

    @Test void theEventDateCheckReadsTheCatalogue() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(contains("to_regclass('hrms.company_notices')"), eq(Boolean.class))).thenReturn(true);
        assertTrue(new NoticesSource(jdbc).hasEventDate());
        when(jdbc.queryForObject(contains("to_regclass('hrms.company_notices')"), eq(Boolean.class))).thenReturn(null);
        assertFalse(new NoticesSource(jdbc).hasEventDate());
    }

    // ── team probation ends ──────────────────────────────────────────────────

    @Test void teamProbationEndsAreTheirTeamOnProbationInTheWindow() {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        WorkforceDepartmentRepository departments = mock(WorkforceDepartmentRepository.class);
        when(departments.findAllById(any())).thenReturn(List.of());
        List<Employee> team = new ArrayList<>();
        team.add(person("Aditya", EmploymentStatus.PROBATION, TODAY.plusDays(8)));    // in
        team.add(person("Rohit", EmploymentStatus.PROBATION, TODAY.plusDays(15)));    // one past
        team.add(person("Sita", EmploymentStatus.ACTIVE, TODAY.plusDays(3)));         // confirmed already
        team.add(person("Old", EmploymentStatus.PROBATION, TODAY.minusDays(1)));      // overdue: a needs-you matter, not an upcoming date
        team.add(person("Edge", EmploymentStatus.PROBATION, TODAY));                  // today
        when(scope.teamOf(me)).thenReturn(team);
        List<AroundItem> out = new TeamProbationEndsSource(scope, departments).load(caller("attendance.team.read"), me, TODAY, TODAY.plusDays(14));
        assertEquals(List.of("Aditya Rao’s probation ends", "Edge Rao’s probation ends"), out.stream().map(AroundItem::title).toList());
        assertEquals("/team", out.get(0).link());
        verify(scope).teamOf(me);
    }

    private Employee person(String first, EmploymentStatus status, LocalDate probationEnd) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setTenantId(TENANT);
        e.setCompanyId(COMPANY);
        e.setFirstName(first);
        e.setLastName("Rao");
        e.setEmploymentStatus(status);
        e.setProbationEndDate(probationEnd);
        e.setJobTitle("SDE II");
        return e;
    }
}
