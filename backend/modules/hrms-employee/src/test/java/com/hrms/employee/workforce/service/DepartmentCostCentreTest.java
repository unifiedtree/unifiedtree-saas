package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDepartmentRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DepartmentResponse;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** BW-95: the department cost centre (side table, JDBC) and the head's name. */
class DepartmentCostCentreTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID company = UUID.randomUUID();
    private WorkforceDepartmentRepository repo;
    private JdbcTemplate jdbc;
    private DepartmentService service;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
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

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private void tableExists(boolean exists) {
        when(jdbc.queryForObject(startsWith("SELECT to_regclass('hrms.department_cost_centres')"), eq(Boolean.class))).thenReturn(exists);
    }

    @Test
    void createWritesTheCostCentreAfterTheDepartment() {
        tableExists(true);
        DepartmentResponse r = service.create(new CreateDepartmentRequest(company, "Sales", null, null, null, null, null, null, null, "  CC-100 "));
        verify(jdbc).update(startsWith("INSERT INTO hrms.department_cost_centres"), eq(tenant), eq(r.id()), eq("CC-100"));
    }

    @Test
    void missingTableRefusesACostCentreBeforeAnythingIsSaved() {
        tableExists(false);
        assertThatThrownBy(() -> service.create(new CreateDepartmentRequest(company, "Sales", null, null, null, null, null, null, null, "CC-1")))
                .isInstanceOf(FeatureNotReady.class);
        verify(repo, never()).saveAndFlush(any());
        UUID id = UUID.randomUUID();
        assertThatThrownBy(() -> service.updateDetails(id, null, null, "CC-1")).isInstanceOf(FeatureNotReady.class);
        verify(repo, never()).findById(id);
    }

    @Test
    void withoutACostCentreNothingTouchesTheTable() {
        tableExists(false);
        DepartmentResponse r = service.create(new CreateDepartmentRequest(company, "Sales", null, null, null, null, null, null, null));
        assertThat(r.costCentre()).isNull();
        verify(jdbc, never()).update(startsWith("INSERT INTO hrms.department_cost_centres"), any(), any(), any());
    }

    @Test
    void blankClearsNullLeavesAndTooLongIsRefused() {
        tableExists(true);
        Department d = new Department();
        d.setId(UUID.randomUUID());
        d.setCompanyId(company);
        d.setName("Sales");
        when(repo.findById(d.getId())).thenReturn(Optional.of(d));
        service.updateDetails(d.getId(), null, null, "  ");
        verify(jdbc).update(startsWith("DELETE FROM hrms.department_cost_centres"), eq(tenant), eq(d.getId()));
        service.updateDetails(d.getId(), null, "desc");
        verify(jdbc, never()).update(startsWith("INSERT INTO hrms.department_cost_centres"), any(), any(), any());
        assertThatThrownBy(() -> service.updateDetails(d.getId(), null, null, "x".repeat(51)))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("errorCode", "COST_CENTRE_TOO_LONG");
        assertThat(DepartmentService.cleanCostCentre(" CC-9 ")).isEqualTo("CC-9");
        assertThat(DepartmentService.cleanCostCentre("")).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void theHeadsNameComesWithTheDepartment() {
        tableExists(false);
        UUID head = UUID.randomUUID();
        Department d = new Department();
        d.setId(UUID.randomUUID());
        d.setCompanyId(company);
        d.setName("Sales");
        d.setDepartmentHeadEmployeeId(head);
        when(repo.findById(d.getId())).thenReturn(Optional.of(d));
        when(jdbc.query(startsWith("SELECT first_name, last_name FROM hrms.employees"), any(RowMapper.class), eq(head)))
                .thenReturn(List.of("Priya Nair"));
        DepartmentResponse r = service.setHead(d.getId(), head);
        assertThat(r.headName()).isEqualTo("Priya Nair");
        assertThat(r.costCentre()).isNull();
        assertThat(DepartmentService.fullName(" Priya ", null)).isEqualTo("Priya");
        assertThat(DepartmentService.fullName(null, " ")).isNull();
    }
}
