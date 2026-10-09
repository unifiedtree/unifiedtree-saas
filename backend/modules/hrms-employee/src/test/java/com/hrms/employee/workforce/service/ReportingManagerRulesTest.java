package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.service.EmployeeContactGuard;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.entity.WorkforceEmployee.EmploymentStatus;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.employee.workforce.repository.WorkforceEmployeeRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.lang.reflect.RecordComponent;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who someone reports to (PUT / POST /v1/hrms/employees): a manager must be an
 * active employee of the workspace, not the person themself and not someone who
 * already reports up to them; a manager can be removed; and moving someone to
 * another department moves them to its head unless HR picked their manager by hand.
 */
class ReportingManagerRulesTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final UUID ENGINEERING = UUID.randomUUID();
    private static final UUID SALES = UUID.randomUUID();

    private WorkforceEmployeeRepository repository;
    private WorkforceDepartmentRepository departments;
    private WorkforceEmployeeService service;
    private final Map<UUID, WorkforceEmployee> people = new HashMap<>();

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        repository = mock(WorkforceEmployeeRepository.class);
        departments = mock(WorkforceDepartmentRepository.class);
        service = new WorkforceEmployeeService(repository, departments, mock(JdbcTemplate.class),
                mock(SeatQuotaEnforcer.class), mock(EmployeeContactGuard.class));
        when(repository.findById(any(UUID.class))).thenAnswer(i -> Optional.ofNullable(people.get(i.<UUID>getArgument(0))));
        when(repository.saveAndFlush(any(WorkforceEmployee.class))).thenAnswer(i -> i.getArgument(0));
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    @SuppressWarnings("unchecked")
    private static <R extends Record> R request(Class<R> type, Map<String, Object> values) {
        try {
            RecordComponent[] comps = type.getRecordComponents();
            Object[] args = new Object[comps.length];
            Class<?>[] types = new Class<?>[comps.length];
            for (int i = 0; i < comps.length; i++) {
                types[i] = comps[i].getType();
                args[i] = values.get(comps[i].getName());
            }
            return (R) type.getDeclaredConstructor(types).newInstance(args);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static UpdateWorkforceEmployeeRequest edit(Map<String, Object> values) {
        return request(UpdateWorkforceEmployeeRequest.class, values);
    }

    private WorkforceEmployee person(String name, UUID department, UUID manager) {
        WorkforceEmployee e = new WorkforceEmployee();
        e.setId(UUID.randomUUID());
        e.setTenantId(TENANT);
        e.setCompanyId(COMPANY);
        e.setFirstName(name);
        e.setDepartmentId(department);
        e.setReportingManagerId(manager);
        e.setEmploymentStatus(EmploymentStatus.ACTIVE);
        people.put(e.getId(), e);
        return e;
    }

    private void head(UUID department, WorkforceEmployee head) {
        Department d = new Department();
        d.setId(department);
        d.setDepartmentHeadEmployeeId(head == null ? null : head.getId());
        when(departments.findById(department)).thenReturn(Optional.of(d));
    }

    // ── Changing the manager ────────────────────────────────────────────────

    @Test
    void anActiveColleagueCanBeTheNewManager() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee ravi = person("Ravi", ENGINEERING, null);
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, kavitha.getId());

        service.update(varsha.getId(), edit(Map.of("reportingManagerId", ravi.getId())));

        assertThat(varsha.getReportingManagerId()).isEqualTo(ravi.getId());
    }

    @Test
    void nobodyReportsToThemselves() {
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, null);

        assertThatThrownBy(() -> service.update(varsha.getId(), edit(Map.of("reportingManagerId", varsha.getId()))))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("themselves");
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void anIdThatIsNobodyIsRefused() {
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, null);

        assertThatThrownBy(() -> service.update(varsha.getId(), edit(Map.of("reportingManagerId", UUID.randomUUID()))))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("wasn't found");
    }

    @Test
    void someoneFromAnotherWorkspaceIsNotFound() {
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, null);
        WorkforceEmployee stranger = person("Stranger", null, null);
        stranger.setTenantId(UUID.randomUUID());

        assertThatThrownBy(() -> service.update(varsha.getId(), edit(Map.of("reportingManagerId", stranger.getId()))))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("wasn't found");
    }

    @Test
    void someoneWhoLeftCantBeTheManager() {
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, null);
        WorkforceEmployee gone = person("Gone", ENGINEERING, null);
        gone.setEmploymentStatus(EmploymentStatus.EXITED);

        assertThatThrownBy(() -> service.update(varsha.getId(), edit(Map.of("reportingManagerId", gone.getId()))))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("still works here");
    }

    @Test
    void aManagerWhoAlreadyReportsUpToThePersonWouldMakeALoop() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee ravi = person("Ravi", ENGINEERING, kavitha.getId());
        WorkforceEmployee asha = person("Asha", ENGINEERING, ravi.getId());

        // Kavitha → Asha would close Asha → Ravi → Kavitha → Asha.
        assertThatThrownBy(() -> service.update(kavitha.getId(), edit(Map.of("reportingManagerId", asha.getId()))))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("loop");
        assertThat(kavitha.getReportingManagerId()).isNull();
    }

    @Test
    void aLoopAlreadyInTheDataDoesNotHangTheCheck() {
        WorkforceEmployee a = person("A", ENGINEERING, null);
        WorkforceEmployee b = person("B", ENGINEERING, a.getId());
        a.setReportingManagerId(b.getId());   // A ↔ B, saved before these checks existed
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, null);

        service.update(varsha.getId(), edit(Map.of("reportingManagerId", a.getId())));

        assertThat(varsha.getReportingManagerId()).isEqualTo(a.getId());
    }

    @Test
    void reSavingAManagerWhoHasSinceLeftStillSaves() {
        WorkforceEmployee gone = person("Gone", ENGINEERING, null);
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, gone.getId());
        gone.setEmploymentStatus(EmploymentStatus.EXITED);

        // The Job tab sends every field back, the unchanged manager included.
        service.update(varsha.getId(), edit(Map.of("reportingManagerId", gone.getId(), "firstName", "Varsha")));

        assertThat(varsha.getReportingManagerId()).isEqualTo(gone.getId());
    }

    @Test
    void theManagerCanBeRemoved() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, kavitha.getId());

        service.update(varsha.getId(), edit(Map.of("clearReportingManager", true)));

        assertThat(varsha.getReportingManagerId()).isNull();
    }

    @Test
    void leavingTheManagerOutKeepsIt() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, kavitha.getId());

        service.update(varsha.getId(), edit(Map.of("firstName", "Varsha")));

        assertThat(varsha.getReportingManagerId()).isEqualTo(kavitha.getId());
    }

    // ── Moving to another department ────────────────────────────────────────

    @Test
    void movingDepartmentMovesThemToTheNewHeadWhenTheyReportedToTheOldOne() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee suresh = person("Suresh", SALES, null);
        head(ENGINEERING, kavitha);
        head(SALES, suresh);
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, kavitha.getId());

        service.update(varsha.getId(), edit(Map.of("departmentId", SALES)));

        assertThat(varsha.getReportingManagerId()).isEqualTo(suresh.getId());
    }

    @Test
    void movingDepartmentKeepsAManagerHrPickedByHand() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee suresh = person("Suresh", SALES, null);
        WorkforceEmployee ravi = person("Ravi", ENGINEERING, kavitha.getId());
        head(ENGINEERING, kavitha);
        head(SALES, suresh);
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, ravi.getId());

        service.update(varsha.getId(), edit(Map.of("departmentId", SALES)));

        assertThat(varsha.getReportingManagerId()).isEqualTo(ravi.getId());
    }

    @Test
    void movingDepartmentAndPickingAManagerTogetherKeepsThePick() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee suresh = person("Suresh", SALES, null);
        WorkforceEmployee meena = person("Meena", SALES, suresh.getId());
        head(ENGINEERING, kavitha);
        head(SALES, suresh);
        WorkforceEmployee varsha = person("Varsha", ENGINEERING, kavitha.getId());

        service.update(varsha.getId(), edit(Map.of("departmentId", SALES, "reportingManagerId", meena.getId())));

        assertThat(varsha.getReportingManagerId()).isEqualTo(meena.getId());
    }

    @Test
    void movingIntoADepartmentWhoseHeadNoLongerWorksHereKeepsTheManager() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee gone = person("Gone", SALES, null);
        head(ENGINEERING, kavitha);
        head(SALES, gone);
        for (EmploymentStatus status : List.of(EmploymentStatus.EXITED, EmploymentStatus.TERMINATED, EmploymentStatus.SUSPENDED)) {
            gone.setEmploymentStatus(status);
            WorkforceEmployee varsha = person("Varsha", ENGINEERING, kavitha.getId());
            WorkforceEmployee newcomer = person("Newcomer", ENGINEERING, null);

            service.update(varsha.getId(), edit(Map.of("departmentId", SALES)));
            service.update(newcomer.getId(), edit(Map.of("departmentId", SALES)));

            assertThat(varsha.getDepartmentId()).isEqualTo(SALES);   // the move itself still saves
            assertThat(varsha.getReportingManagerId()).isEqualTo(kavitha.getId());
            assertThat(newcomer.getReportingManagerId()).isNull();
        }
    }

    @Test
    void theNewHeadThemselfKeepsTheirManager() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        head(ENGINEERING, kavitha);
        WorkforceEmployee suresh = person("Suresh", ENGINEERING, kavitha.getId());
        head(SALES, suresh);

        service.update(suresh.getId(), edit(Map.of("departmentId", SALES)));

        assertThat(suresh.getReportingManagerId()).isEqualTo(kavitha.getId());
    }

    // ── Adding someone ──────────────────────────────────────────────────────

    private static CreateWorkforceEmployeeRequest add(UUID department, UUID manager) {
        Map<String, Object> v = new HashMap<>(Map.of("companyId", COMPANY, "employeeCode", "EMP-0100", "firstName", "New"));
        if (department != null) v.put("departmentId", department);
        if (manager != null) v.put("reportingManagerId", manager);
        return request(CreateWorkforceEmployeeRequest.class, v);
    }

    @Test
    void aNewHireWithNoManagerPickedReportsToTheDepartmentHead() {
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        head(ENGINEERING, kavitha);

        assertThat(service.create(add(ENGINEERING, null)).reportingManagerId()).isEqualTo(kavitha.getId());
    }

    @Test
    void aNewHireCantBeGivenSomeoneWhoLeft() {
        WorkforceEmployee gone = person("Gone", ENGINEERING, null);
        gone.setEmploymentStatus(EmploymentStatus.TERMINATED);

        assertThatThrownBy(() -> service.create(add(ENGINEERING, gone.getId())))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("still works here");
        verify(repository, never()).saveAndFlush(any());
    }

    // ── A department's new head ─────────────────────────────────────────────

    /** DepartmentHeadChange reads people over JDBC; this one sees the people the test made. */
    @SuppressWarnings("unchecked")
    private JdbcTemplate jdbcOverPeople() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(org.mockito.ArgumentMatchers.contains("employment_status"), any(RowMapper.class), any(Object[].class)))
                .thenAnswer(i -> Optional.ofNullable(people.get(i.<UUID>getArgument(2))).map(List::of).orElse(List.of()));
        return jdbc;
    }

    @Test
    void aNewHeadTakesOverThePeopleWhoReportedToTheOldOne() {
        JdbcTemplate jdbc = jdbcOverPeople();
        UUID oldHead = UUID.randomUUID(), newHead = person("Ravi", ENGINEERING, null).getId();
        when(jdbc.update(anyString(), any(), any(), any(), any())).thenReturn(4);

        assertThat(DepartmentHeadChange.moveReports(jdbc, ENGINEERING, oldHead, newHead)).isEqualTo(4);
        verify(jdbc).update(org.mockito.ArgumentMatchers.contains("SET reporting_manager_id = ?"),
                org.mockito.ArgumentMatchers.eq(newHead), org.mockito.ArgumentMatchers.eq(ENGINEERING),
                org.mockito.ArgumentMatchers.eq(oldHead), org.mockito.ArgumentMatchers.eq(newHead));
    }

    @Test
    void promotingSomeoneTwoLevelsDownLeavesTheirOwnManagersOutOfTheMove() {
        // Kavitha heads Engineering, Ravi reports to her and Asha to Ravi. Asha becomes the head.
        JdbcTemplate jdbc = jdbcOverPeople();
        WorkforceEmployee kavitha = person("Kavitha", ENGINEERING, null);
        WorkforceEmployee ravi = person("Ravi", ENGINEERING, kavitha.getId());
        WorkforceEmployee asha = person("Asha", ENGINEERING, ravi.getId());

        DepartmentHeadChange.moveReports(jdbc, ENGINEERING, kavitha.getId(), asha.getId());

        // Ravi → Asha would close Asha → Ravi → Asha, so Ravi (and Kavitha above him) stay where they are.
        verify(jdbc).update(org.mockito.ArgumentMatchers.contains("AND id NOT IN (?,?)"),
                org.mockito.ArgumentMatchers.eq(asha.getId()), org.mockito.ArgumentMatchers.eq(ENGINEERING),
                org.mockito.ArgumentMatchers.eq(kavitha.getId()), org.mockito.ArgumentMatchers.eq(asha.getId()),
                org.mockito.ArgumentMatchers.eq(ravi.getId()), org.mockito.ArgumentMatchers.eq(kavitha.getId()));
    }

    @Test
    void aNewHeadWhoNoLongerWorksHereTakesOverNobody() {
        JdbcTemplate jdbc = jdbcOverPeople();
        UUID oldHead = UUID.randomUUID();
        WorkforceEmployee exited = person("Exited", ENGINEERING, null);
        exited.setEmploymentStatus(EmploymentStatus.EXITED);
        WorkforceEmployee terminated = person("Terminated", ENGINEERING, null);
        terminated.setEmploymentStatus(EmploymentStatus.TERMINATED);
        WorkforceEmployee suspended = person("Suspended", ENGINEERING, null);
        suspended.setEmploymentStatus(EmploymentStatus.SUSPENDED);
        WorkforceEmployee stranger = person("Stranger", null, null);
        stranger.setTenantId(UUID.randomUUID());

        for (UUID head : List.of(exited.getId(), terminated.getId(), suspended.getId(), stranger.getId(), UUID.randomUUID())) {
            assertThat(DepartmentHeadChange.moveReports(jdbc, ENGINEERING, oldHead, head)).isZero();
        }
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void clearingOrKeepingTheHeadMovesNobody() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID head = UUID.randomUUID();

        assertThat(DepartmentHeadChange.moveReports(jdbc, ENGINEERING, head, null)).isZero();
        assertThat(DepartmentHeadChange.moveReports(jdbc, ENGINEERING, null, head)).isZero();
        assertThat(DepartmentHeadChange.moveReports(jdbc, ENGINEERING, head, head)).isZero();
        org.mockito.Mockito.verifyNoInteractions(jdbc);
    }
}
