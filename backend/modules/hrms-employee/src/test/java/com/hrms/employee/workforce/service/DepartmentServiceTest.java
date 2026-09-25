package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDepartmentRequest;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Moving a department (no loops) and department branches on create (V143.22). */
class DepartmentServiceTest {

    private WorkforceDepartmentRepository repo;
    private JdbcTemplate jdbc;
    private DepartmentService service;
    private final UUID company = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        repo = mock(WorkforceDepartmentRepository.class);
        jdbc = mock(JdbcTemplate.class);
        service = new DepartmentService(repo, mock(LiveHeadcount.class), jdbc);
        when(repo.save(any(Department.class))).thenAnswer(i -> i.getArgument(0));
        when(repo.saveAndFlush(any(Department.class))).thenAnswer(i -> {
            Department d = i.getArgument(0);
            if (d.getId() == null) d.setId(UUID.randomUUID());
            return d;
        });
        when(repo.findByCompanyIdAndNameIgnoreCase(any(), anyString())).thenReturn(Optional.empty());
    }

    private Department dept(String name, UUID parent, UUID companyId) {
        Department d = new Department();
        d.setId(UUID.randomUUID());
        d.setCompanyId(companyId);
        d.setName(name);
        d.setParentDepartmentId(parent);
        d.setActive(true);
        when(repo.findById(d.getId())).thenReturn(Optional.of(d));
        return d;
    }

    @Test
    void movesUnderAnotherDepartmentAndBackToTheTop() {
        Department eng = dept("Engineering", null, company);
        Department qa = dept("QA", null, company);

        assertThat(service.moveUnder(qa.getId(), eng.getId()).parentDepartmentId()).isEqualTo(eng.getId());
        assertThat(service.moveUnder(qa.getId(), null).parentDepartmentId()).isNull();
    }

    @Test
    void cannotBeItsOwnParent() {
        Department eng = dept("Engineering", null, company);
        assertThatThrownBy(() -> service.moveUnder(eng.getId(), eng.getId()))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("own parent");
    }

    @Test
    void cannotMoveUnderOneOfItsOwnSubTeams() {
        Department eng = dept("Engineering", null, company);
        Department platform = dept("Platform", eng.getId(), company);
        Department infra = dept("Infra", platform.getId(), company);

        assertThatThrownBy(() -> service.moveUnder(eng.getId(), infra.getId()))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("inside Engineering");
        assertThat(eng.getParentDepartmentId()).isNull();
    }

    @Test
    void theParentMustBeAnActiveDepartmentOfTheSameCompany() {
        Department eng = dept("Engineering", null, company);
        Department elsewhere = dept("Sales", null, UUID.randomUUID());
        Department archived = dept("Old", null, company);
        archived.setActive(false);

        assertThatThrownBy(() -> service.moveUnder(eng.getId(), elsewhere.getId())).hasMessageContaining("another company");
        assertThatThrownBy(() -> service.moveUnder(eng.getId(), archived.getId())).hasMessageContaining("archived");
        assertThatThrownBy(() -> service.moveUnder(eng.getId(), UUID.randomUUID())).hasMessageContaining("doesn't exist");
    }

    @Test
    void createStoresTheBranchesItWasGiven() {
        UUID b1 = UUID.randomUUID(), b2 = UUID.randomUUID();
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(Object[].class))).thenReturn(2);

        service.create(new CreateDepartmentRequest(company, "Data", "DAT", null, null, null, null, null, List.of(b1, b2, b1)));

        verify(jdbc).update(eq("DELETE FROM hrms.department_branches WHERE department_id = ?"), any(Object.class));
        verify(jdbc).update(anyString(), any(), any(), eq(b1));
        verify(jdbc).update(anyString(), any(), any(), eq(b2));
    }

    @Test
    void branchesOfAnotherCompanyAreRefused() {
        Department eng = dept("Engineering", null, company);
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(Object[].class))).thenReturn(0);

        assertThatThrownBy(() -> service.setBranches(eng.getId(), List.of(UUID.randomUUID())))
                .hasMessageContaining("own company");
        verify(jdbc, never()).update(eq("DELETE FROM hrms.department_branches WHERE department_id = ?"), any(Object.class));
    }
}
