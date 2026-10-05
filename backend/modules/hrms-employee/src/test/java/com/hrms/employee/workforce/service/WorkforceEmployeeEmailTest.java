package com.hrms.employee.workforce.service;

import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.service.EmailAlreadyUsedException;
import com.hrms.employee.service.EmployeeContactGuard;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.employee.workforce.repository.WorkforceEmployeeRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.lang.reflect.RecordComponent;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Add employee and Edit details (POST / PUT /v1/hrms/employees — the web drawer,
 * the onboarding wizard, the phone's Add staff, the import, the hiring
 * conversion and the Users &amp; access invite all create through here): one work
 * email per employee in the workspace, case and spaces ignored.
 */
class WorkforceEmployeeEmailTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final UUID OTHER_COMPANY = UUID.randomUUID();

    private WorkforceEmployeeRepository repository;
    private EmployeeContactGuard guard;
    private WorkforceEmployeeService service;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        repository = mock(WorkforceEmployeeRepository.class);
        guard = mock(EmployeeContactGuard.class);
        service = new WorkforceEmployeeService(repository, mock(WorkforceDepartmentRepository.class),
                mock(JdbcTemplate.class), mock(SeatQuotaEnforcer.class), guard);
        when(repository.saveAndFlush(any(WorkforceEmployee.class))).thenAnswer(i -> i.getArgument(0));
        when(repository.save(any(WorkforceEmployee.class))).thenAnswer(i -> i.getArgument(0));
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    /** A request with only these fields set (the records have dozens of components). */
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

    private static CreateWorkforceEmployeeRequest add(UUID company, String email) {
        Map<String, Object> v = new HashMap<>(Map.of("companyId", company, "employeeCode", "EMP-0100", "firstName", "Ravi", "lastName", "K"));
        v.put("email", email);
        return request(CreateWorkforceEmployeeRequest.class, v);
    }

    private static UpdateWorkforceEmployeeRequest edit(String email) {
        return request(UpdateWorkforceEmployeeRequest.class, Map.of("email", email));
    }

    private static WorkforceEmployee stored(UUID id, String email) {
        WorkforceEmployee e = new WorkforceEmployee();
        e.setId(id);
        e.setCompanyId(COMPANY);
        e.setEmail(email);
        e.setFirstName("Ravi");
        return e;
    }

    @Test
    void addingChecksTheWholeWorkspaceAndSavesTheAddressTrimmedAndLowerCased() {
        service.create(add(COMPANY, "  READER@UnifiedTree.demo "));
        verify(guard).assertEmailFree("reader@unifiedtree.demo", null);
        ArgumentCaptor<WorkforceEmployee> saved = ArgumentCaptor.forClass(WorkforceEmployee.class);
        verify(repository).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getEmail()).isEqualTo("reader@unifiedtree.demo");
    }

    @Test
    void aTakenEmailStopsTheAddBeforeAnythingIsSaved() {
        doThrow(new EmailAlreadyUsedException("This email already belongs to Reader User (EMP002)."))
                .when(guard).assertEmailFree(anyString(), any());
        // Another company of the same workspace: refused all the same (it used to be checked per company).
        assertThatThrownBy(() -> service.create(add(OTHER_COMPANY, "Reader@unifiedtree.demo")))
                .isInstanceOf(EmailAlreadyUsedException.class)
                .hasMessage("This email already belongs to Reader User (EMP002).");
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void addingWithoutAnEmailChecksNothing() {
        service.create(add(COMPANY, null));
        verify(guard, never()).assertEmailFree(any(), any());
    }

    @Test
    void someoneSavingTheSameEmailMeanwhileGetsThe409NotA500() {
        when(repository.saveAndFlush(any(WorkforceEmployee.class))).thenThrow(new DataIntegrityViolationException(
                "could not execute statement", new RuntimeException("duplicate key value violates unique constraint \"uq_employees_tenant_email_norm\"")));
        assertThatThrownBy(() -> service.create(add(COMPANY, "new@x.com")))
                .isInstanceOf(EmailAlreadyUsedException.class)
                .hasMessage(EmployeeContactGuard.GENERIC_EMAIL_MESSAGE);
    }

    @Test
    void anyOtherConstraintStillFailsAsBefore() {
        when(repository.saveAndFlush(any(WorkforceEmployee.class)))
                .thenThrow(new DataIntegrityViolationException("uq_employee_company_code"));
        assertThatThrownBy(() -> service.create(add(COMPANY, "new@x.com")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void editingToAnotherAddressChecksEveryoneButThisPerson() {
        UUID id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.of(stored(id, "ravi@x.com")));
        service.update(id, edit(" Asha@X.com"));
        verify(guard).assertEmailFree("asha@x.com", id);
        ArgumentCaptor<WorkforceEmployee> saved = ArgumentCaptor.forClass(WorkforceEmployee.class);
        verify(repository).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getEmail()).isEqualTo("asha@x.com");
    }

    @Test
    void aNewCaseOrSpacesAloneIsTheSameAddressAndIsNotChecked() {
        UUID id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.of(stored(id, "Ravi@x.com")));
        service.update(id, edit("ravi@X.com "));
        verify(guard, never()).assertEmailFree(any(), any());
        ArgumentCaptor<WorkforceEmployee> saved = ArgumentCaptor.forClass(WorkforceEmployee.class);
        verify(repository).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getEmail()).isEqualTo("ravi@x.com");
    }

    @Test
    void anEditToATakenEmailIsRefusedAndNothingIsSaved() {
        UUID id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.of(stored(id, "ravi@x.com")));
        doThrow(new EmailAlreadyUsedException("taken")).when(guard).assertEmailFree(eq("asha@x.com"), eq(id));
        assertThatThrownBy(() -> service.update(id, edit("asha@x.com"))).isInstanceOf(EmailAlreadyUsedException.class);
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void anEditThatLeavesTheEmailOutChecksNothing() {
        UUID id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.of(stored(id, "ravi@x.com")));
        service.update(id, request(UpdateWorkforceEmployeeRequest.class, Map.of("firstName", "Ravi")));
        verify(guard, never()).assertEmailFree(any(), any());
    }
}
