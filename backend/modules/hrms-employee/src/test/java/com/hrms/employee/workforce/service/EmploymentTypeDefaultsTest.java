package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.service.EmployeeContactGuard;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.entity.EmploymentType;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.repository.EmploymentTypeRepository;
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
import java.util.List;
import java.util.Map;
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

/**
 * Employment types, owner decision 6 Oct 2026: five fixed defaults every company has (seeded, idempotent),
 * the company's own types can be given to people, and the defaults can't be removed, renamed or switched off.
 */
class EmploymentTypeDefaultsTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    private JdbcTemplate jdbc;
    private EmploymentTypeRepository types;
    private EmploymentTypeService typeService;
    private WorkforceEmployeeRepository employees;
    private WorkforceEmployeeService employeeService;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        jdbc = mock(JdbcTemplate.class);
        types = mock(EmploymentTypeRepository.class);
        when(types.save(any(EmploymentType.class))).thenAnswer(i -> i.getArgument(0));
        typeService = new EmploymentTypeService(types, jdbc);
        employees = mock(WorkforceEmployeeRepository.class);
        when(employees.saveAndFlush(any(WorkforceEmployee.class))).thenAnswer(i -> i.getArgument(0));
        employeeService = new WorkforceEmployeeService(employees, mock(WorkforceDepartmentRepository.class),
                jdbc, mock(SeatQuotaEnforcer.class), mock(EmployeeContactGuard.class));
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // -- the five defaults --------------------------------------------------

    @Test
    void theFiveDefaultsAreTheCodesEmployeeRecordsAlwaysHeld() {
        assertThat(EmploymentTypeCodes.DEFAULTS).extracting(EmploymentTypeCodes.Default::code)
                .containsExactly("FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT");
        assertThat(EmploymentTypeCodes.DEFAULTS).extracting(EmploymentTypeCodes.Default::name)
                .containsExactly("Full-time", "Part-time", "Contract", "Intern", "Consultant");
        // The built-in enum is unchanged: the same five codes, in the same order.
        assertThat(List.of(WorkforceEmployee.EmploymentType.values())).extracting(Enum::name)
                .containsExactlyElementsOf(EmploymentTypeCodes.DEFAULTS.stream().map(EmploymentTypeCodes.Default::code).toList());
        assertThat(EmploymentTypeCodes.isDefault(" full_time ")).isTrue();
        assertThat(EmploymentTypeCodes.isDefault("APPRENTICE")).isFalse();
        assertThat(EmploymentTypeCodes.isDefault(null)).isFalse();
        assertThat(EmploymentTypeCodes.defaultNamed("Full Time")).isEqualTo(EmploymentTypeCodes.DEFAULTS.get(0));
        assertThat(EmploymentTypeCodes.defaultNamed("Apprentice")).isNull();
    }

    @Test
    void seedingAddsOnlyWhatIsMissingAndNeverChangesARow() {
        // The statement itself: inserts per missing code, skips any row with that code, never updates.
        assertThat(EmploymentTypeCodes.SEED_SQL).contains("NOT EXISTS").contains("ON CONFLICT DO NOTHING")
                .doesNotContain("UPDATE").doesNotContain("DELETE").doesNotContain("DO UPDATE");
        when(jdbc.queryForObject(EmploymentTypeCodes.MISSING_SQL, Integer.class, COMPANY)).thenReturn(3);
        when(jdbc.update(EmploymentTypeCodes.SEED_SQL, COMPANY)).thenReturn(2);
        assertThat(EmploymentTypeCodes.seedDefaults(jdbc, COMPANY)).isEqualTo(2);
    }

    @Test
    void seedingACompanyThatHasAllFiveRunsNoInsert() {
        when(jdbc.queryForObject(EmploymentTypeCodes.MISSING_SQL, Integer.class, COMPANY)).thenReturn(5);
        assertThat(EmploymentTypeCodes.seedDefaults(jdbc, COMPANY)).isZero();
        verify(jdbc, never()).update(eq(EmploymentTypeCodes.SEED_SQL), any(Object[].class));
        assertThat(EmploymentTypeCodes.seedDefaults(jdbc, null)).isZero();
    }

    @Test
    void listingSeedsTheDefaultsFirstAndCanIncludeSwitchedOffTypes() {
        when(jdbc.queryForObject(EmploymentTypeCodes.MISSING_SQL, Integer.class, COMPANY)).thenReturn(0);
        EmploymentType off = type("APPRENTICE", "Apprentice", false), on = type("FULL_TIME", "Full-time", true);
        when(types.findByCompanyIdOrderByNameAsc(COMPANY)).thenReturn(List.of(off, on));
        when(types.findByCompanyIdAndActiveTrueOrderByNameAsc(COMPANY)).thenReturn(List.of(on));

        assertThat(typeService.listForCompany(COMPANY)).containsExactly(on);
        verify(jdbc).update(EmploymentTypeCodes.SEED_SQL, COMPANY);
        // Master's list: switched-off ones too, after the active ones.
        assertThat(typeService.listForCompany(COMPANY, true)).containsExactly(on, off);
    }

    @Test
    void aDefaultCantBeRemovedRenamedRecodedOrSwitchedOff() {
        EmploymentType contract = type("CONTRACT", "Contract", true);
        UUID id = contract.getId();
        when(types.findById(id)).thenReturn(Optional.of(contract));

        assertThatThrownBy(() -> typeService.archive(id)).isInstanceOf(BusinessRuleException.class)
                .hasMessageContaining("can’t be removed");
        assertThatThrownBy(() -> typeService.update(id, type("CONTRACT", "Agency staff", true)))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("renamed");
        assertThatThrownBy(() -> typeService.update(id, type("AGENCY", "Contract", true)))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("re-coded");
        assertThatThrownBy(() -> typeService.update(id, type("CONTRACT", "Contract", false)))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("switched off");
        assertThat(contract.isActive()).isTrue();
        assertThat(contract.getName()).isEqualTo("Contract");

        // What it sends back unchanged saves (payroll eligible is the one field it may change).
        EmploymentType same = type("CONTRACT", "Contract", true);
        same.setPayrollEligible(false);
        assertThat(typeService.update(id, same).isPayrollEligible()).isFalse();
        assertThat(contract.isBuiltIn()).isTrue();
    }

    @Test
    void aSwitchedOffDefaultFromAnOlderWorkspaceCanBeSwitchedOnAgain() {
        EmploymentType intern = type("INTERN", "Interns", false);
        when(types.findById(intern.getId())).thenReturn(Optional.of(intern));
        typeService.update(intern.getId(), type("INTERN", "Interns", true));
        assertThat(intern.isActive()).isTrue();
    }

    @Test
    void aCompanysOwnTypeCanBeAddedEditedAndSwitchedOff() {
        when(types.findByCompanyIdAndCode(COMPANY, "APPRENTICE")).thenReturn(Optional.empty());
        when(types.findByCompanyIdAndActiveTrueOrderByNameAsc(COMPANY)).thenReturn(List.of(type("FULL_TIME", "Full Time", true)));
        EmploymentType asked = type(" apprentice ", " Apprentice ", true);
        asked.setSystem(true); // a request can't make its own type a system row
        EmploymentType made = typeService.create(asked);
        assertThat(made.getCode()).isEqualTo("APPRENTICE");
        assertThat(made.getName()).isEqualTo("Apprentice");
        assertThat(made.isSystem()).isFalse();
        assertThat(made.isBuiltIn()).isFalse();

        when(types.findById(made.getId())).thenReturn(Optional.of(made));
        typeService.update(made.getId(), type("APPRENTICE", "Trainee", true));
        assertThat(made.getName()).isEqualTo("Trainee");
        typeService.archive(made.getId());
        assertThat(made.isActive()).isFalse();
    }

    @Test
    void aCompanysOwnTypeCantTakeADefaultsNameOrCode() {
        when(types.findByCompanyIdAndCode(any(), anyString())).thenReturn(Optional.empty());
        when(types.findByCompanyIdAndActiveTrueOrderByNameAsc(COMPANY)).thenReturn(List.of(type("GIG", "Gig worker", true)));
        assertThatThrownBy(() -> typeService.create(type("PERM", "Full time", true)))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("default type's name");
        assertThatThrownBy(() -> typeService.create(type("GIG2", "gig-worker", true)))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("already has a type called");
        // Asking for a default's code again: the defaults are seeded, so it already exists.
        EmploymentType seeded = type("PART_TIME", "Part-time", true);
        when(types.findByCompanyIdAndCode(COMPANY, "PART_TIME")).thenReturn(Optional.of(seeded));
        assertThatThrownBy(() -> typeService.create(type("part_time", "Half days", true)))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("already exists");
        assertThat(seeded.getName()).isEqualTo("Part-time");
    }

    @Test
    void aCodePeopleHoldCantChange() {
        EmploymentType gig = type("GIG", "Gig worker", true);
        when(types.findById(gig.getId())).thenReturn(Optional.of(gig));
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(COMPANY), eq("GIG"))).thenReturn(4);
        assertThatThrownBy(() -> typeService.update(gig.getId(), type("GIGS", "Gig worker", true)))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("code can’t change");
        assertThat(gig.getCode()).isEqualTo("GIG");
    }

    // -- people ---------------------------------------------------------------

    @Test
    void aPersonCanBeGivenTheirCompanysOwnActiveType() {
        when(jdbc.queryForList(EmploymentTypeCodes.ACTIVE_CODE_SQL, String.class, COMPANY, "APPRENTICE"))
                .thenReturn(List.of("APPRENTICE"));
        employeeService.create(add("apprentice"));
        assertThat(savedType()).isEqualTo("APPRENTICE");
    }

    @Test
    void aTypeTheCompanyDoesntHaveIsRefusedBeforeAnythingIsSaved() {
        when(jdbc.queryForList(eq(EmploymentTypeCodes.ACTIVE_CODE_SQL), eq(String.class), any(), any())).thenReturn(List.of());
        assertThatThrownBy(() -> employeeService.create(add("GIG")))
                .isInstanceOf(BusinessRuleException.class)
                .satisfies(e -> assertThat(((BusinessRuleException) e).getErrorCode()).isEqualTo("EMPLOYMENT_TYPE_UNKNOWN"));
        verify(employees, never()).saveAndFlush(any());
    }

    @Test
    void theDefaultsWorkAsBeforeWithoutLookingAnythingUp() {
        employeeService.create(add("CONTRACT"));
        assertThat(savedType()).isEqualTo("CONTRACT");
        employeeService.create(add(null));
        assertThat(savedType()).isEqualTo("FULL_TIME"); // none given: Full-time, as before
        verify(jdbc, never()).queryForList(eq(EmploymentTypeCodes.ACTIVE_CODE_SQL), eq(String.class), any(Object[].class));
    }

    @Test
    void editingSomeoneWhoseTypeWasSwitchedOffKeepsIt() {
        WorkforceEmployee e = new WorkforceEmployee();
        e.setId(UUID.randomUUID());
        e.setCompanyId(COMPANY);
        e.setEmploymentType("SEASONAL");
        when(employees.findById(e.getId())).thenReturn(Optional.of(e));
        employeeService.update(e.getId(), request(UpdateWorkforceEmployeeRequest.class, Map.of("employmentType", "SEASONAL")));
        assertThat(e.getEmploymentType()).isEqualTo("SEASONAL");
        verify(jdbc, never()).queryForList(eq(EmploymentTypeCodes.ACTIVE_CODE_SQL), eq(String.class), any(Object[].class));
    }

    @Test
    void beforeV143_104TheOldCheckGivesAClearMessageNotA500() {
        when(jdbc.queryForList(EmploymentTypeCodes.ACTIVE_CODE_SQL, String.class, COMPANY, "APPRENTICE"))
                .thenReturn(List.of("APPRENTICE"));
        when(employees.saveAndFlush(any(WorkforceEmployee.class))).thenThrow(new DataIntegrityViolationException("x",
                new RuntimeException("new row for relation \"employees\" violates check constraint \"ck_employees_employment_type\"")));
        assertThatThrownBy(() -> employeeService.create(add("APPRENTICE")))
                .isInstanceOf(BusinessRuleException.class)
                .satisfies(x -> assertThat(((BusinessRuleException) x).getErrorCode()).isEqualTo("EMPLOYMENT_TYPE_NOT_READY"));
    }

    // -- helpers --------------------------------------------------------------

    private static EmploymentType type(String code, String name, boolean active) {
        EmploymentType t = new EmploymentType();
        t.setId(UUID.randomUUID());
        t.setCompanyId(COMPANY);
        t.setCode(code);
        t.setName(name);
        t.setActive(active);
        return t;
    }

    private String savedType() {
        ArgumentCaptor<WorkforceEmployee> saved = ArgumentCaptor.forClass(WorkforceEmployee.class);
        verify(employees, org.mockito.Mockito.atLeastOnce()).saveAndFlush(saved.capture());
        return saved.getValue().getEmploymentType();
    }

    private static CreateWorkforceEmployeeRequest add(String type) {
        Map<String, Object> v = new HashMap<>(Map.of("companyId", COMPANY, "employeeCode", "EMP-0" + Math.abs(new java.util.Random().nextInt(9999)),
                "firstName", "Ravi", "lastName", "K"));
        v.put("employmentType", type);
        return request(CreateWorkforceEmployeeRequest.class, v);
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
}
