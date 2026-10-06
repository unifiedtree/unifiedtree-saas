package com.hrms.api.workforce;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.hrms.api.hiring.ConversionOnboardingStarter;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDepartmentRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.rbac.security.PermissionChecker;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** BW-94: onboarding on Add employee is opt-in, needs the onboarding permission, and never undoes the create. */
class NewHireOnboardingTest {

    private ConversionOnboardingStarter starter;
    private PermissionChecker checker;
    private NewHireOnboarding onboarding;
    private final UUID employeeId = UUID.randomUUID();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        starter = mock(ConversionOnboardingStarter.class);
        checker = mock(PermissionChecker.class);
        ObjectProvider<PermissionChecker> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(checker);
        onboarding = new NewHireOnboarding(starter, provider);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private WorkforceEmployeeResponse employee() {
        return new WorkforceEmployeeResponse(employeeId, UUID.randomUUID(), "EMP-9", "Asha", null, "Rao", "asha@example.com",
                null, null, null, UUID.randomUUID(), null, null, null, null, WorkforceEmployee.EmploymentType.FULL_TIME.name(),
                WorkforceEmployee.EmploymentStatus.PROBATION, LocalDate.of(2026, 10, 1), null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, List.of(6, 7), null, false, false, true);
    }

    private static void signIn(String... permissions) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("u", null,
                java.util.Arrays.stream(permissions).map(SimpleGrantedAuthority::new).toList()));
    }

    @Test
    void startsTheFittingChecklist() {
        UUID run = UUID.randomUUID();
        when(starter.start(any())).thenReturn(new ConversionOnboardingStarter.Started(run, "Joining checklist"));
        NewHireOnboarding.Outcome o = onboarding.start(employee(), true);
        assertThat(o.status()).isEqualTo(NewHireOnboarding.Status.STARTED);
        assertThat(o.onboarding()).isEqualTo(new NewHireOnboarding.Started(run, "Joining checklist"));
    }

    @Test
    void noChecklistFitsNotAllowedAndFailuresNeverThrow() {
        when(starter.start(any())).thenReturn(null);
        assertThat(onboarding.start(employee(), true).status()).isEqualTo(NewHireOnboarding.Status.NO_CHECKLIST);
        assertThat(onboarding.start(employee(), false).status()).isEqualTo(NewHireOnboarding.Status.NOT_ALLOWED);
        when(starter.start(any())).thenThrow(new IllegalStateException("template has no tasks"));
        NewHireOnboarding.Outcome failed = onboarding.start(employee(), true);
        assertThat(failed.status()).isEqualTo(NewHireOnboarding.Status.FAILED);
        assertThat(failed.onboarding()).isNull();
    }

    @Test
    void allowedFromTheTokenElseTheDatabase() {
        signIn(NewHireOnboarding.INSTANCE_WRITE);
        assertThat(onboarding.allowed()).isTrue();
        signIn("hrms.employee.write");
        when(checker.check(NewHireOnboarding.INSTANCE_WRITE)).thenReturn(false);
        assertThat(onboarding.allowed()).isFalse();
        when(checker.check(NewHireOnboarding.INSTANCE_WRITE)).thenReturn(true);
        assertThat(onboarding.allowed()).isTrue();
        when(checker.check(NewHireOnboarding.INSTANCE_WRITE)).thenThrow(new IllegalStateException("db down"));
        assertThat(onboarding.allowed()).isFalse();
    }

    @Test
    void createWithoutTheFlagIsExactlyAsBeforeAndNeverStartsOnboarding() {
        WorkforceEmployeeService employees = mock(WorkforceEmployeeService.class);
        WorkforceController controller = new WorkforceController(null, null, null, null, employees, null, null, null, null, null, null);
        NewHireOnboarding spy = mock(NewHireOnboarding.class);
        ReflectionTestUtils.setField(controller, "newHireOnboarding", spy);
        WorkforceEmployeeResponse created = employee();
        when(employees.create(any(CreateWorkforceEmployeeRequest.class))).thenReturn(created);
        Object body = controller.createEmployee(CreateWorkforceEmployeeRequest.minimal(created.companyId(), "Asha", "Rao", null), false, null);
        assertThat(body).isSameAs(created);
        verify(spy, never()).start(any(), org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void createWithTheFlagAddsOnboardingNextToEveryEmployeeField() throws Exception {
        WorkforceEmployeeService employees = mock(WorkforceEmployeeService.class);
        WorkforceController controller = new WorkforceController(null, null, null, null, employees, null, null, null, null, null, null);
        ReflectionTestUtils.setField(controller, "newHireOnboarding", onboarding);
        WorkforceEmployeeResponse created = employee();
        when(employees.create(any(CreateWorkforceEmployeeRequest.class))).thenReturn(created);
        UUID run = UUID.randomUUID();
        when(starter.start(created)).thenReturn(new ConversionOnboardingStarter.Started(run, "Joining checklist"));
        signIn(NewHireOnboarding.INSTANCE_WRITE);

        Object body = controller.createEmployee(CreateWorkforceEmployeeRequest.minimal(created.companyId(), "Asha", "Rao", null), true, null);
        ObjectMapper json = new ObjectMapper().registerModule(new JavaTimeModule());
        JsonNode node = json.valueToTree(body);
        JsonNode plain = json.valueToTree(created);
        plain.fieldNames().forEachRemaining(f -> assertThat(node.get(f)).as(f).isEqualTo(plain.get(f)));
        assertThat(node.get("onboarding").get("instanceId").asText()).isEqualTo(run.toString());
        assertThat(node.get("onboarding").get("templateName").asText()).isEqualTo("Joining checklist");
        assertThat(node.get("onboardingStatus").asText()).isEqualTo("STARTED");
        assertThat(node.has("employee")).isFalse();
    }

    @Test
    void departmentRequestsStillReadFromJsonWithAndWithoutACostCentre() throws Exception {
        ObjectMapper json = new ObjectMapper();
        UUID company = UUID.randomUUID();
        CreateDepartmentRequest without = json.readValue("{\"companyId\":\"" + company + "\",\"name\":\"Sales\"}", CreateDepartmentRequest.class);
        assertThat(without.name()).isEqualTo("Sales");
        assertThat(without.costCentre()).isNull();
        CreateDepartmentRequest with = json.readValue(
                "{\"companyId\":\"" + company + "\",\"name\":\"Sales\",\"branchIds\":[],\"costCentre\":\"CC-100\"}", CreateDepartmentRequest.class);
        assertThat(with.costCentre()).isEqualTo("CC-100");
        assertThat(with.companyId()).isEqualTo(company);
    }
}
