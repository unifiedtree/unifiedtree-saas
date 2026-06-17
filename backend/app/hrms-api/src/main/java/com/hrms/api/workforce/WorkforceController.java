package com.hrms.api.workforce;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.BranchResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.ClassificationRuleResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CompanyResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.ContractorResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateBranchRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateClassificationRuleRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateCompanyRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateContractorRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDepartmentRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDesignationRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DepartmentResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.DesignationResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateCompanyRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateDesignationRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateGeofenceRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceFilter;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.entity.Grade;
import com.hrms.employee.workforce.entity.EmploymentType;
import com.hrms.employee.workforce.entity.Shift;
import com.hrms.employee.workforce.service.BranchService;
import com.hrms.employee.workforce.service.ClassificationRuleService;
import com.hrms.employee.workforce.service.CompanyService;
import com.hrms.employee.workforce.service.ContractorService;
import com.hrms.employee.workforce.service.DepartmentService;
import com.hrms.employee.workforce.service.DesignationService;
import com.hrms.employee.workforce.service.EmploymentTypeService;
import com.hrms.employee.workforce.service.GradeService;
import com.hrms.employee.workforce.service.ShiftService;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.hrms.api.invitation.InvitationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * REST surface for the HR workforce module - covers Companies, Branches,
 * Departments, Designations, Workforce Directory, Contractors and
 * Classification Rules per the client HR dashboard spec.
 *
 * <p>All endpoints are tenant-scoped via the JWT - RLS in Postgres enforces
 * data isolation; the service layer never sees rows from other tenants.
 */
@RestController
@RequestMapping("/v1/hrms")
public class WorkforceController {

    private static final Logger log = LoggerFactory.getLogger(WorkforceController.class);

    private final CompanyService            companies;
    private final BranchService             branches;
    private final DepartmentService         departments;
    private final DesignationService        designations;
    private final WorkforceEmployeeService  employees;
    private final ContractorService         contractors;
    private final ClassificationRuleService classifications;
    private final GradeService              grades;
    private final EmploymentTypeService     employmentTypes;
    private final ShiftService              shifts;
    private final InvitationService         invitationService;

    public WorkforceController(CompanyService companies,
                               @Qualifier("workforceBranchService") BranchService branches,
                               @Qualifier("workforceDepartmentService") DepartmentService departments,
                               DesignationService designations,
                               WorkforceEmployeeService employees,
                               ContractorService contractors,
                               ClassificationRuleService classifications,
                               GradeService grades,
                               EmploymentTypeService employmentTypes,
                               ShiftService shifts,
                               @Autowired(required = false) InvitationService invitationService) {
        this.companies = companies;
        this.branches = branches;
        this.departments = departments;
        this.designations = designations;
        this.employees = employees;
        this.contractors = contractors;
        this.classifications = classifications;
        this.grades = grades;
        this.employmentTypes = employmentTypes;
        this.shifts = shifts;
        this.invitationService = invitationService;
    }

    // -- Companies -----------------------------------------------------------
    @GetMapping("/companies")
    @PreAuthorize("isAuthenticated()")
    public List<CompanyResponse> listCompanies() {
        return companies.list();
    }

    @PostMapping("/companies")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('org.company.write')")
    public CompanyResponse createCompany(@Valid @RequestBody CreateCompanyRequest req) {
        return companies.create(req);
    }

    @GetMapping("/companies/{id}")
    @PreAuthorize("isAuthenticated()")
    public CompanyResponse getCompany(@PathVariable UUID id) {
        return companies.get(id);
    }

    @PutMapping("/companies/{id}")
    @PreAuthorize("hasAuthority('org.company.write')")
    public CompanyResponse updateCompany(@PathVariable UUID id,
                                         @Valid @RequestBody UpdateCompanyRequest req) {
        return companies.update(id, req);
    }

    @DeleteMapping("/companies/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('org.company.write')")
    public void archiveCompany(@PathVariable UUID id) {
        companies.archive(id);
    }

    // -- Branches ------------------------------------------------------------
    @GetMapping("/branches")
    @PreAuthorize("isAuthenticated()")
    public List<BranchResponse> listBranches(@RequestParam(required = false) UUID companyId) {
        return companyId == null ? branches.listAll() : branches.listForCompany(companyId);
    }

    @PostMapping("/branches")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('org.company.write')")
    public BranchResponse createBranch(@Valid @RequestBody CreateBranchRequest req) {
        return branches.create(req);
    }

    @PutMapping("/branches/{id}/geofence")
    @PreAuthorize("hasAuthority('org.geofence.write')")
    public BranchResponse updateGeofence(@PathVariable UUID id,
                                         @Valid @RequestBody UpdateGeofenceRequest req) {
        return branches.updateGeofence(id, req);
    }

    @DeleteMapping("/branches/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('org.company.write')")
    public void archiveBranch(@PathVariable UUID id) {
        branches.archive(id);
    }

    // -- Departments ---------------------------------------------------------
    @GetMapping("/departments")
    @PreAuthorize("isAuthenticated()")
    public List<DepartmentResponse> listDepartments(@RequestParam UUID companyId) {
        return departments.listForCompany(companyId);
    }

    @PostMapping("/departments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.department.write')")
    public DepartmentResponse createDepartment(@Valid @RequestBody CreateDepartmentRequest req) {
        return departments.create(req);
    }

    @PatchMapping("/departments/{id}/name")
    @PreAuthorize("hasAuthority('hrms.department.write')")
    public DepartmentResponse renameDepartment(@PathVariable UUID id,
                                               @RequestParam String name) {
        return departments.rename(id, name);
    }

    @PatchMapping("/departments/{id}/head")
    @PreAuthorize("hasAuthority('hrms.department.write')")
    public DepartmentResponse setDepartmentHead(@PathVariable UUID id,
                                                @RequestParam(required = false) UUID employeeId) {
        return departments.setHead(id, employeeId);
    }

    @DeleteMapping("/departments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.department.write')")
    public void archiveDepartment(@PathVariable UUID id) {
        departments.archive(id);
    }

    // -- Designations --------------------------------------------------------
    @GetMapping("/designations")
    @PreAuthorize("isAuthenticated()")
    public List<DesignationResponse> listDesignations(@RequestParam UUID companyId,
                                                      @RequestParam(required = false) UUID departmentId) {
        return designations.listForCompany(companyId, departmentId);
    }

    @PostMapping("/designations")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.designation.write')")
    public DesignationResponse createDesignation(@Valid @RequestBody CreateDesignationRequest req) {
        return designations.create(req);
    }

    @PutMapping("/designations/{id}")
    @PreAuthorize("hasAuthority('hrms.designation.write')")
    public DesignationResponse updateDesignation(@PathVariable UUID id,
                                                 @Valid @RequestBody UpdateDesignationRequest req) {
        return designations.update(id, req);
    }

    @DeleteMapping("/designations/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.designation.write')")
    public void archiveDesignation(@PathVariable UUID id) {
        designations.archive(id);
    }

    // -- Workforce directory (employees) -------------------------------------
    @GetMapping("/employees")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER') or hasAuthority('hrms.employee.read')")
    public PageResponse<WorkforceEmployeeResponse> directory(
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) UUID branchId,
            @RequestParam(required = false) WorkforceEmployee.EmploymentStatus status,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int pageSize) {
        return employees.directory(new WorkforceFilter(companyId, departmentId, branchId, status, search, page, pageSize));
    }

    @GetMapping("/employees/{id}")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER') or hasAuthority('hrms.employee.read')")
    public WorkforceEmployeeResponse getEmployee(@PathVariable UUID id) {
        return employees.get(id);
    }

    @PostMapping("/employees")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public WorkforceEmployeeResponse createEmployee(@Valid @RequestBody CreateWorkforceEmployeeRequest req,
                                                    @AuthenticationPrincipal Jwt jwt) {
        WorkforceEmployeeResponse emp = employees.create(req);
        // Security: never create a credential with a default password — that
        // gives every onboarded employee a publicly-known login. Instead, fire
        // the invitation flow so the canonical credential is born with
        // active=false / password_hash=null and a single-use token is emailed.
        // The send is best-effort: a misconfigured SMTP must not roll back the
        // create or surface a 5xx to the admin — they can resend from the
        // staff profile if the email never arrives.
        if (invitationService != null && emp.email() != null && !emp.email().isBlank() && jwt != null) {
            try {
                UUID actorId = UUID.fromString(jwt.getSubject());
                invitationService.sendInvitation(emp.id(), TenantContext.getTenantId(), actorId);
            } catch (RuntimeException ex) {
                log.warn("Invitation for {} (employee {}) failed to queue: {}",
                        emp.email(), emp.id(), ex.getMessage());
            }
        }
        return emp;
    }

    @PutMapping("/employees/{id}")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public WorkforceEmployeeResponse updateEmployee(@PathVariable UUID id,
                                                    @Valid @RequestBody UpdateWorkforceEmployeeRequest req) {
        return employees.update(id, req);
    }

    @PostMapping("/employees/{id}/confirm")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public WorkforceEmployeeResponse confirm(@PathVariable UUID id,
                                             @RequestParam LocalDate confirmationDate) {
        return employees.confirm(id, confirmationDate);
    }

    @PostMapping("/employees/{id}/notice")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public WorkforceEmployeeResponse startNotice(@PathVariable UUID id,
                                                 @RequestParam LocalDate noticeStart,
                                                 @RequestParam LocalDate lastWorkingDay,
                                                 @RequestParam(required = false) String reason) {
        return employees.startNotice(id, noticeStart, lastWorkingDay, reason);
    }

    @PostMapping("/employees/{id}/exit")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public WorkforceEmployeeResponse exit(@PathVariable UUID id,
                                          @RequestParam LocalDate lastWorkingDay,
                                          @RequestParam(required = false) String reason) {
        return employees.exit(id, lastWorkingDay, reason);
    }

    // -- Contractors ---------------------------------------------------------
    @GetMapping("/contractors")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER')")
    public List<ContractorResponse> listContractors(@RequestParam UUID companyId) {
        return contractors.listForCompany(companyId);
    }

    @PostMapping("/contractors")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.contractor.write')")
    public ContractorResponse createContractor(@Valid @RequestBody CreateContractorRequest req) {
        return contractors.create(req);
    }

    @DeleteMapping("/contractors/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.contractor.write')")
    public void archiveContractor(@PathVariable UUID id) {
        contractors.archive(id);
    }

    // -- Classification rules ------------------------------------------------
    @GetMapping("/classifications")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public List<ClassificationRuleResponse> listClassifications(@RequestParam UUID companyId) {
        return classifications.listForCompany(companyId);
    }

    @PostMapping("/classifications")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public ClassificationRuleResponse createClassification(@Valid @RequestBody CreateClassificationRuleRequest req) {
        return classifications.create(req);
    }

    @DeleteMapping("/classifications/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public void archiveClassification(@PathVariable UUID id) {
        classifications.archive(id);
    }

    // -- Grades --------------------------------------------------------------
    @GetMapping("/grades")
    @PreAuthorize("isAuthenticated()")
    public List<Grade> listGrades(@RequestParam UUID companyId) {
        return grades.listForCompany(companyId);
    }

    @PostMapping("/grades")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@perm.check('hrms.grade.write')")
    public Grade createGrade(@Valid @RequestBody Grade grade) {
        return grades.create(grade);
    }

    @PutMapping("/grades/{id}")
    @PreAuthorize("@perm.check('hrms.grade.write')")
    public Grade updateGrade(@PathVariable UUID id, @Valid @RequestBody Grade grade) {
        return grades.update(id, grade);
    }

    @DeleteMapping("/grades/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("@perm.check('hrms.grade.write')")
    public void archiveGrade(@PathVariable UUID id) {
        grades.archive(id);
    }

    // -- Employment types ----------------------------------------------------
    @GetMapping("/employment-types")
    @PreAuthorize("isAuthenticated()")
    public List<EmploymentType> listEmploymentTypes(@RequestParam UUID companyId) {
        return employmentTypes.listForCompany(companyId);
    }

    @PostMapping("/employment-types")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@perm.check('hrms.employment-type.write')")
    public EmploymentType createEmploymentType(@Valid @RequestBody EmploymentType type) {
        return employmentTypes.create(type);
    }

    @PutMapping("/employment-types/{id}")
    @PreAuthorize("@perm.check('hrms.employment-type.write')")
    public EmploymentType updateEmploymentType(@PathVariable UUID id, @Valid @RequestBody EmploymentType type) {
        return employmentTypes.update(id, type);
    }

    @DeleteMapping("/employment-types/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("@perm.check('hrms.employment-type.write')")
    public void archiveEmploymentType(@PathVariable UUID id) {
        employmentTypes.archive(id);
    }

    // -- Shifts --------------------------------------------------------------
    @GetMapping("/shifts")
    @PreAuthorize("isAuthenticated()")
    public List<Shift> listShifts(@RequestParam UUID companyId) {
        return shifts.listForCompany(companyId);
    }

    @PostMapping("/shifts")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@perm.check('hrms.shift.write')")
    public Shift createShift(@Valid @RequestBody Shift shift) {
        return shifts.create(shift);
    }

    @PutMapping("/shifts/{id}")
    @PreAuthorize("@perm.check('hrms.shift.write')")
    public Shift updateShift(@PathVariable UUID id, @Valid @RequestBody Shift shift) {
        return shifts.update(id, shift);
    }

    @DeleteMapping("/shifts/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("@perm.check('hrms.shift.write')")
    public void archiveShift(@PathVariable UUID id) {
        shifts.archive(id);
    }
}
