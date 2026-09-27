package com.hrms.api.workforce;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.employee.workforce.repository.WorkforceEmployeeRepository;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * BW-97, a privacy change: who sees what of one employee record
 * (GET /v1/hrms/employees/{id}).
 * <ul>
 *   <li>hrms.employee.read: the full record, as before (bank masked unless pii.read);</li>
 *   <li>the direct manager with hrms.employee.team.manage only: the list view, with no pay, bank or identity field;</li>
 *   <li>any other manager, and the manager's manager: 403.</li>
 * </ul>
 */
class ManagerRecordAccessTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID manager = UUID.randomUUID();
    private final UUID report = UUID.randomUUID();
    private final UUID stranger = UUID.randomUUID();
    private WorkforceEmployeeRepository repository;
    private JdbcTemplate jdbc;
    private WorkforceController controller;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        repository = mock(WorkforceEmployeeRepository.class);
        jdbc = mock(JdbcTemplate.class);
        WorkforceEmployeeService service = new WorkforceEmployeeService(repository, mock(WorkforceDepartmentRepository.class),
                jdbc, mock(SeatQuotaEnforcer.class));
        when(repository.findById(report)).thenReturn(Optional.of(person(report, manager)));
        when(repository.findById(stranger)).thenReturn(Optional.of(person(stranger, UUID.randomUUID())));
        when(jdbc.queryForList(anyString(), eq(UUID.class), eq(report), eq(tenant))).thenReturn(List.of(manager));
        when(jdbc.queryForList(anyString(), eq(UUID.class), eq(stranger), eq(tenant))).thenReturn(Arrays.asList((UUID) null));
        controller = new WorkforceController(null, null, null, null, service, null, null, null, null, null, null);
        ReflectionTestUtils.setField(controller, "jdbc", jdbc);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        TenantContext.clear();
    }

    private static WorkforceEmployee person(UUID id, UUID reportsTo) {
        WorkforceEmployee e = new WorkforceEmployee();
        e.setId(id);
        e.setCompanyId(UUID.randomUUID());
        e.setEmployeeCode("EMP-7");
        e.setFirstName("Reader");
        e.setLastName("Person");
        e.setEmail("reader@example.com");
        e.setReportingManagerId(reportsTo);
        e.setDateOfJoining(LocalDate.of(2025, 1, 1));
        e.setCtcAnnual(new BigDecimal("1200000"));
        e.setMonthlySalary(new BigDecimal("100000"));
        e.setSalaryFrequency("MONTHLY");
        e.setPanNumber("ABCDE1234F");
        e.setAadhaarNumber("123412341234");
        e.setPassportNumber("Z1234567");
        e.setPfUan("100200300400");
        e.setEsiNumber("1234567890");
        e.setBankName("HDFC");
        e.setBankAccountNumber("123456789012");
        e.setBankIfsc("HDFC0001234");
        e.setBankBranchName("MG Road");
        e.setExitReason("Personal");
        return e;
    }

    private static void signIn(String... permissions) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("u", null,
                Arrays.stream(permissions).map(SimpleGrantedAuthority::new).toList()));
    }

    private static Jwt token(UUID employeeId) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString());
        if (employeeId != null) b.claim("employee_id", employeeId.toString());
        return b.build();
    }

    private static void assertNoPayBankOrIdentity(WorkforceEmployeeResponse r) throws Exception {
        assertThat(r.ctcAnnual()).isNull();
        assertThat(r.monthlySalary()).isNull();
        assertThat(r.salaryFrequency()).isNull();
        assertThat(r.bankAccountNumber()).isNull();
        assertThat(r.bankIfsc()).isNull();
        assertThat(r.bankBranchName()).isNull();
        assertThat(r.uan()).isNull();
        assertThat(r.esi()).isNull();
        assertThat(r.exitReason()).isNull();
        String json = new ObjectMapper().registerModule(new JavaTimeModule()).writeValueAsString(r);
        for (String secret : List.of("1200000", "100000", "ABCDE1234F", "123412341234", "Z1234567", "100200300400",
                "1234567890", "HDFC", "123456789012", "MG Road", "Personal")) {
            assertThat(json).doesNotContain(secret);
        }
    }

    @Test
    void theDirectManagerGetsTheListViewWithoutPayBankOrIdentity() throws Exception {
        signIn(WorkforceAccess.TEAM_MANAGE);
        WorkforceEmployeeResponse r = controller.getEmployee(report, token(manager));
        assertThat(r.id()).isEqualTo(report);
        assertThat(r.firstName()).isEqualTo("Reader");
        assertThat(r.reportingManagerId()).isEqualTo(manager);
        assertNoPayBankOrIdentity(r);
    }

    @Test
    void anotherPersonsReportIsRefused() {
        signIn(WorkforceAccess.TEAM_MANAGE);
        assertThatThrownBy(() -> controller.getEmployee(stranger, token(manager))).isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void aLoginWithoutAnEmployeeRecordIsRefused() {
        signIn(WorkforceAccess.TEAM_MANAGE);
        assertThatThrownBy(() -> controller.getEmployee(report, token(null))).isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void theManagersManagerIsRefused() {
        signIn(WorkforceAccess.TEAM_MANAGE);
        UUID skipLevel = UUID.randomUUID();
        assertThatThrownBy(() -> controller.getEmployee(report, token(skipLevel))).isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void employeeReadHoldersStillGetTheFullRecord() {
        signIn(WorkforceAccess.EMPLOYEE_READ);
        WorkforceEmployeeResponse r = controller.getEmployee(stranger, token(UUID.randomUUID()));
        assertThat(r.uan()).isEqualTo("100200300400");
        assertThat(r.bankIfsc()).isEqualTo("HDFC0001234");
        assertThat(r.bankAccountNumber()).isEqualTo("****9012");   // masked without hrms.employees.pii.read, as before
        assertThat(r.ctcAnnual()).isNull();                          // salary only with pii.read, as before
        signIn(WorkforceAccess.EMPLOYEE_READ, "hrms.employees.pii.read");
        assertThat(controller.getEmployee(stranger, token(null)).ctcAnnual()).isEqualByComparingTo("1200000");
    }

    @Test
    void holdingBothIsTheFullRecordEvenForYourOwnReport() {
        signIn(WorkforceAccess.EMPLOYEE_READ, WorkforceAccess.TEAM_MANAGE);
        assertThat(controller.getEmployee(report, token(manager)).uan()).isEqualTo("100200300400");
    }

    @Test
    void theRuleByItself() {
        UUID a = UUID.randomUUID();
        assertThat(WorkforceAccess.recordView(true, false, null, null)).isEqualTo(WorkforceAccess.RecordView.FULL);
        assertThat(WorkforceAccess.recordView(false, true, a, a)).isEqualTo(WorkforceAccess.RecordView.LIST);
        assertThat(WorkforceAccess.recordView(false, false, a, a)).isEqualTo(WorkforceAccess.RecordView.DENIED);
        assertThat(WorkforceAccess.recordView(false, true, a, UUID.randomUUID())).isEqualTo(WorkforceAccess.RecordView.DENIED);
        assertThat(WorkforceAccess.recordView(false, true, null, null)).isEqualTo(WorkforceAccess.RecordView.DENIED);
        assertThat(WorkforceAccess.recordView(false, true, a, null)).isEqualTo(WorkforceAccess.RecordView.DENIED);
    }

    @Test
    void employeeIdComesFromTheClaimOnly() {
        UUID id = UUID.randomUUID();
        assertThat(WorkforceAccess.employeeId(token(id))).isEqualTo(id);
        assertThat(WorkforceAccess.employeeId(token(null))).isNull();   // never the subject (the user id)
        assertThat(WorkforceAccess.employeeId(Jwt.withTokenValue("t").header("alg", "none").claim("employee_id", "junk").build())).isNull();
        assertThat(WorkforceAccess.employeeId(null)).isNull();
    }

    @Test
    void responseKeysOfTheListViewAreTheDirectorysKeys() throws Exception {
        signIn(WorkforceAccess.TEAM_MANAGE);
        JsonNode node = new ObjectMapper().registerModule(new JavaTimeModule()).valueToTree(controller.getEmployee(report, token(manager)));
        assertThat(node.has("ctcAnnual")).isFalse();          // NON_NULL: the key is absent, as in the directory
        assertThat(node.has("monthlySalary")).isFalse();
        assertThat(node.has("bankAccountNumber")).isFalse();
    }
}
