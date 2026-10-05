package com.hrms.employee.service;

import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.dto.CreateEmployeeRequest;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.mapper.EmergencyContactMapper;
import com.hrms.employee.mapper.EmployeeMapper;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.repository.EmergencyContactRepository;
import com.hrms.employee.repository.EmployeeDocumentRepository;
import com.hrms.employee.repository.EmployeeRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The older create (POST /v1/employees and /v1/employees/staff): the same email rule, for the work and the personal email. */
class EmployeeServiceEmailTest {

    private EmployeeRepository repository;
    private EmployeeContactGuard guard;
    private EmployeeService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        TenantContext.setTenantId(UUID.randomUUID());
        repository = mock(EmployeeRepository.class);
        guard = mock(EmployeeContactGuard.class);
        EmployeeMapper mapper = mock(EmployeeMapper.class);
        when(mapper.toEntity(any())).thenAnswer(i -> {
            CreateEmployeeRequest r = i.getArgument(0);
            Employee e = new Employee();
            e.setEmail(r.email());
            e.setPersonalEmail(r.personalEmail());
            return e;
        });
        when(repository.save(any(Employee.class))).thenAnswer(i -> i.getArgument(0));
        service = new EmployeeService(repository, mock(EmergencyContactRepository.class), mock(EmployeeDocumentRepository.class),
                mapper, mock(EmergencyContactMapper.class), mock(EmployeeCodeGenerator.class), mock(KafkaTemplate.class),
                mock(OnboardingService.class), mock(JdbcTemplate.class), mock(SeatQuotaEnforcer.class), guard, false);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private static CreateEmployeeRequest request(String email, String personal) {
        return new CreateEmployeeRequest("Ravi", "K", null, email, personal, null, null, null, UUID.randomUUID(),
                null, null, null, null, null, null, 0, null, null, null, null, null, null, null, null, null, null, null, null);
    }

    @Test
    void bothEmailsAreCheckedAndSavedTrimmedAndLowerCased() {
        service.createEmployee(request(" Ravi@X.com", "RAVI.home@Gmail.com  "));
        verify(guard).assertEmailFree("ravi@x.com", null);
        verify(guard).assertEmailFree("ravi.home@gmail.com", null);
        ArgumentCaptor<Employee> saved = ArgumentCaptor.forClass(Employee.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().getEmail()).isEqualTo("ravi@x.com");
        assertThat(saved.getValue().getPersonalEmail()).isEqualTo("ravi.home@gmail.com");
    }

    @Test
    void aPersonalEmailThatIsSomeoneElsesWorkEmailIsRefused() {
        doThrow(new EmailAlreadyUsedException("This email already belongs to Aisha Khan (EMP-0003)."))
                .when(guard).assertEmailFree(eq("aisha@x.com"), isNull());
        assertThatThrownBy(() -> service.createEmployee(request("ravi@x.com", "Aisha@x.com")))
                .isInstanceOf(EmailAlreadyUsedException.class)
                .hasMessage("This email already belongs to Aisha Khan (EMP-0003).");
        verify(repository, never()).save(any());
    }

    @Test
    void noPersonalEmailIsFine() {
        service.createEmployee(request("ravi@x.com", "  "));
        verify(guard).assertEmailFree("ravi@x.com", null);
        ArgumentCaptor<Employee> saved = ArgumentCaptor.forClass(Employee.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().getPersonalEmail()).isNull();
    }
}
