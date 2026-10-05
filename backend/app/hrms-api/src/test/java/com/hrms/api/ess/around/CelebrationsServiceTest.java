package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.ess.around.CelebrationsService.Celebration;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.support.TransactionOperations;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Celebrations: birthdays and anniversaries from a week back to N days ahead,
 * people who joined in the last 30 days, all in the caller's company, in date
 * order; a login without an employee record reads nothing; one failing kind is
 * named and the others still answer.
 */
class CelebrationsServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 5);

    private Employee me;
    private EmployeeRepository employees;
    private EssSourceRunner runner;

    @BeforeEach
    void wire() {
        me = new Employee();
        me.setId(UUID.randomUUID());
        me.setTenantId(TENANT);
        me.setCompanyId(COMPANY);
        employees = mock(EmployeeRepository.class);
        when(employees.findById(me.getId())).thenReturn(Optional.of(me));
        TenantModuleLookup modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), any())).thenReturn(true);
        runner = new EssSourceRunner(modules, TransactionOperations.withoutTransaction());
    }

    private EssCaller caller() {
        return new EssCaller(TENANT, me.getId(), Set.of(), null, TODAY);
    }

    private static Celebration c(String kind, LocalDate date, String name) {
        return new Celebration(kind, date, UUID.randomUUID(), name, null, null);
    }

    /** A stand-in kind returning fixed rows and recording the windows it was asked for. */
    private static final class Fake implements CelebrationsService.Source {
        final String key; final List<Celebration> rows; final boolean fail;
        LocalDate from, to, joinedFrom;
        Fake(String key, List<Celebration> rows) { this(key, rows, false); }
        Fake(String key, List<Celebration> rows, boolean fail) { this.key = key; this.rows = rows; this.fail = fail; }
        @Override public String key() { return key; }
        @Override public String module() { return null; }
        @Override public boolean allowed(EssCaller caller) { return true; }
        @Override public List<Celebration> load(EssCaller caller, Employee e, LocalDate f, LocalDate t, LocalDate j) {
            from = f; to = t; joinedFrom = j;
            if (fail) throw new IllegalStateException("boom");
            return rows;
        }
    }

    @Test void theWindowsAreAWeekBackToDaysAheadAndThirtyDaysOfJoiners() {
        Fake f = new Fake("BIRTHDAY", List.of());
        CelebrationsService.Response r = new CelebrationsService(List.of(f), runner, employees).celebrations(caller(), null);
        assertEquals(TODAY.minusDays(7), f.from);
        assertEquals(TODAY.plusDays(30), f.to);
        assertEquals(TODAY.minusDays(30), f.joinedFrom);
        assertEquals(TODAY, r.today());
        assertEquals(TODAY.minusDays(30), r.joinedFrom());

        new CelebrationsService(List.of(f), runner, employees).celebrations(caller(), 400);
        assertEquals(TODAY.plusDays(60), f.to, "at most 60 days ahead");
        new CelebrationsService(List.of(f), runner, employees).celebrations(caller(), 0);
        assertEquals(TODAY.plusDays(1), f.to, "at least one day");
    }

    @Test void rowsAreInDateOrderThenKindThenName() {
        LocalDate d1 = TODAY, d2 = TODAY.plusDays(2);
        Fake b = new Fake("BIRTHDAY", List.of(c("BIRTHDAY", d2, "Zoya"), c("BIRTHDAY", d1, "kavya")));
        Fake a = new Fake("WORK_ANNIVERSARY", List.of(c("WORK_ANNIVERSARY", d1, "Asha")));
        Fake j = new Fake("NEW_JOINER", List.of(c("NEW_JOINER", TODAY.minusDays(3), "Ravi")));
        CelebrationsService.Response r = new CelebrationsService(List.of(j, a, b), runner, employees).celebrations(caller(), 14);
        assertEquals(List.of("Ravi", "kavya", "Asha", "Zoya"), r.items().stream().map(Celebration::name).toList());
        assertEquals(List.of("BIRTHDAY", "NEW_JOINER", "WORK_ANNIVERSARY"), r.included());
    }

    @Test void aFailingKindIsNamedAndTheOthersStillAnswer() {
        Fake b = new Fake("BIRTHDAY", List.of(c("BIRTHDAY", TODAY, "Kavya")));
        Fake j = new Fake("NEW_JOINER", List.of(), true);
        CelebrationsService.Response r = new CelebrationsService(List.of(b, j), runner, employees).celebrations(caller(), null);
        assertEquals(1, r.items().size());
        assertEquals(List.of("NEW_JOINER"), r.unavailable());
    }

    @Test void aLoginWithoutAnEmployeeRecordReadsNothing() {
        Fake f = new Fake("BIRTHDAY", List.of(c("BIRTHDAY", TODAY, "x")));
        CelebrationsService.Response r = new CelebrationsService(List.of(f), runner, employees)
                .celebrations(new EssCaller(TENANT, null, Set.of(), null, TODAY), null);
        assertTrue(r.items().isEmpty());
        assertTrue(r.included().isEmpty());
        assertNull(f.from, "nothing is read");
    }

    @Test void birthdaysCarryNoYearsAndAnniversariesDo() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID p = UUID.randomUUID();
        when(jdbc.query(contains("date_of_birth"), any(RowMapper.class), any(), any()))
                .thenReturn(List.of(new YearlyDates.Person(p, "Kavya", "Ops", LocalDate.of(1990, 10, 3))));
        when(jdbc.query(contains("e.date_of_joining AS original"), any(RowMapper.class), any(), any()))
                .thenReturn(List.of(new YearlyDates.Person(p, "Kavya", "Ops", LocalDate.of(2021, 10, 9))));
        List<Celebration> bd = new CelebrationsService.Birthdays(jdbc).load(caller(), me, TODAY.minusDays(7), TODAY.plusDays(30), null);
        assertEquals(1, bd.size());
        assertEquals(LocalDate.of(2026, 10, 3), bd.get(0).date(), "two days ago is still in the window");
        assertNull(bd.get(0).years(), "never an age");
        List<Celebration> an = new CelebrationsService.Anniversaries(jdbc).load(caller(), me, TODAY.minusDays(7), TODAY.plusDays(30), null);
        assertEquals(5, an.get(0).years());
        assertEquals("WORK_ANNIVERSARY", an.get(0).kind());
    }

    @Test void newJoinersAreTheCallersCompanyBetweenJoinedFromAndToday() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any(), any())).thenReturn(List.of());
        new CelebrationsService.Joiners(jdbc).load(caller(), me, null, null, TODAY.minusDays(30));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(RowMapper.class), eq(TENANT), eq(COMPANY), eq(TODAY.minusDays(30)), eq(TODAY));
        assertTrue(sql.getValue().contains("e.tenant_id = ? AND e.company_id = ? AND e.is_active"));
        assertTrue(sql.getValue().contains("e.date_of_joining BETWEEN ? AND ?"));
    }
}
