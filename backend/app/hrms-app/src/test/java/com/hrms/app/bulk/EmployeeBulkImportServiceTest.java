package com.hrms.app.bulk;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** BW-93: imports create every row through the Add-employee path, as ACTIVE, all or nothing. */
class EmployeeBulkImportServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID company = UUID.randomUUID();
    private final UUID sales = UUID.randomUUID();
    private WorkforceEmployeeService workforce;
    private JdbcTemplate jdbc;
    private SeatQuotaEnforcer seats;
    private EmployeeBulkImportService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        TenantContext.setTenantId(tenant);
        workforce = mock(WorkforceEmployeeService.class);
        jdbc = mock(JdbcTemplate.class);
        seats = mock(SeatQuotaEnforcer.class);
        ObjectProvider<SeatQuotaEnforcer> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(seats);
        service = spy(new EmployeeBulkImportService(workforce, jdbc, provider));
        doReturn(new EmployeeImportMapper.Lookups(EmployeeImportMapper.index(Map.of(sales, "Sales")), Set.of(), Map.of(),
                List.of(), List.of(), Set.of(), Set.of())).when(service).lookups(company);
        when(workforce.create(any(CreateWorkforceEmployeeRequest.class), anyBoolean())).thenAnswer(inv -> {
            CreateWorkforceEmployeeRequest r = inv.getArgument(0);
            return new WorkforceEmployeeResponse(UUID.randomUUID(), r.companyId(), "EMP-" + r.firstName(), r.firstName(), null,
                    r.lastName(), r.email(), null, null, null, r.departmentId(), null, null, null, null, r.employmentType(),
                    WorkforceEmployee.EmploymentStatus.ACTIVE, r.dateOfJoining(), null, null, null, null, null, null,
                    null, null, null, null, null, null, null, null, List.of(), null, false, false, true);
        });
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private static MockMultipartFile csv(String body) {
        return new MockMultipartFile("file", "people.csv", "text/csv", body.getBytes(StandardCharsets.UTF_8));
    }

    private static final String HEADER = "first_name,last_name,email,employment_type,date_of_joining,department,job_title\n";

    @Test
    void everyRowGoesThroughTheAddPathAsActive() throws Exception {
        var commit = service.validateAndCommit(csv(HEADER
                + "Asha,Rao,asha@example.com,FULL_TIME,2026-10-01,sales,\n"
                + "Ravi,K,ravi@example.com,INTERN,2026-09-01,,Trainee\n"), company);
        ArgumentCaptor<CreateWorkforceEmployeeRequest> req = ArgumentCaptor.forClass(CreateWorkforceEmployeeRequest.class);
        verify(workforce, times(2)).create(req.capture(), eq(true));
        verify(workforce, never()).create(any(CreateWorkforceEmployeeRequest.class));
        assertThat(req.getAllValues().get(0).departmentId()).isEqualTo(sales);
        assertThat(req.getAllValues().get(0).dateOfJoining()).isEqualTo(LocalDate.of(2026, 10, 1));
        verify(seats).assertCapacity(2);
        // the file's job title is kept (hrms.employees.job_title is not on the workforce entity)
        verify(jdbc).update(startsWith("UPDATE hrms.employees SET job_title"), eq("Trainee"), any(), eq(tenant));
        BulkImportResult r = commit.result();
        assertThat(r.committed()).isTrue();
        assertThat(r.successCount()).isEqualTo(2);
        assertThat(r.errors()).isEmpty();
        assertThat(r.created()).extracting(BulkImportResult.CreatedRow::row).containsExactly(2, 3);
        assertThat(r.created()).allMatch(c -> c.onboarding() == null && c.onboardingStatus() == null);
        assertThat(commit.employees()).hasSize(2);
    }

    @Test
    void aSingleProblemCreatesNobody() throws Exception {
        var commit = service.validateAndCommit(csv(HEADER
                + "Asha,Rao,asha@example.com,FULL_TIME,2026-10-01,Sales,\n"
                + "Ravi,K,ravi@example.com,FULL_TIME,2026-09-01,Marketing,\n"), company);
        verify(workforce, never()).create(any(CreateWorkforceEmployeeRequest.class), anyBoolean());
        verify(seats, never()).assertCapacity(anyInt());
        BulkImportResult r = commit.result();
        assertThat(r.committed()).isFalse();
        assertThat(r.errorCount()).isEqualTo(1);
        assertThat(r.errors()).containsExactly("Row 3: department not found in this company: Marketing");
        assertThat(r.problems()).containsExactly(new BulkImportProblem(3, "department", "department not found in this company: Marketing"));
        assertThat(commit.employees()).isEmpty();
    }

    @Test
    void validateNeverWrites() throws Exception {
        BulkImportResult r = service.validateOnly(csv(HEADER + "Asha,Rao,asha@example.com,FULL_TIME,2026-10-01,Sales,\n"), company);
        assertThat(r.committed()).isFalse();
        assertThat(r.errors()).isEmpty();
        assertThat(r.totalRows()).isEqualTo(1);
        verify(workforce, never()).create(any(CreateWorkforceEmployeeRequest.class), anyBoolean());
    }

    @Test
    void aRowTheAddPathRefusesStopsTheWholeImportWithItsRow() {
        when(workforce.create(any(CreateWorkforceEmployeeRequest.class), anyBoolean()))
                .thenThrow(new BusinessRuleException("Email 'asha@example.com' already in use", "DUPLICATE_EMPLOYEE_EMAIL"));
        assertThatThrownBy(() -> service.validateAndCommit(csv(HEADER + "Asha,Rao,asha@example.com,FULL_TIME,2026-10-01,,\n"), company))
                .isInstanceOf(BusinessRuleException.class)
                .hasMessage("Row 2: Email 'asha@example.com' already in use");
    }

    @Test
    void theTemplateHasTheNewColumnsInBothFormats() throws Exception {
        String csv = new String(service.buildCsvTemplate(), StandardCharsets.UTF_8);
        assertThat(csv.lines().findFirst().orElseThrow().split(",")).containsExactly(
                "first_name", "last_name", "email", "employment_type", "date_of_joining",
                "employee_code", "phone", "department", "designation", "job_title", "branch", "reporting_manager",
                "gender", "date_of_birth", "pan", "uan", "esi", "bank_name", "bank_account", "ifsc");
        byte[] xlsx = service.buildTemplate();
        assertThat(new String(xlsx, 0, 2, StandardCharsets.ISO_8859_1)).isEqualTo("PK");
        assertThat(service.columns().required()).containsExactly("first_name", "last_name", "email", "employment_type", "date_of_joining");
    }

    @Test
    void headerAliasesAreRead() throws Exception {
        service.validateAndCommit(csv("First Name,Last Name,Work Email,Manager,Code,Bank Account Number,IFSC Code\n"
                + "Asha,Rao,asha@example.com,,A-1,123456789012,HDFC0001234\n"), company);
        ArgumentCaptor<CreateWorkforceEmployeeRequest> req = ArgumentCaptor.forClass(CreateWorkforceEmployeeRequest.class);
        verify(workforce).create(req.capture(), eq(true));
        assertThat(req.getValue().email()).isEqualTo("asha@example.com");
        assertThat(req.getValue().employeeCode()).isEqualTo("A-1");
        assertThat(req.getValue().bankAccountNumber()).isEqualTo("123456789012");
        assertThat(req.getValue().bankIfsc()).isEqualTo("HDFC0001234");
    }
}
