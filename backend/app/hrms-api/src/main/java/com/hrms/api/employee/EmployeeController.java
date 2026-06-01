package com.hrms.api.employee;

import com.hrms.auth.service.AuthService;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.enums.Role;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.dto.CreateEmployeeRequest;
import com.hrms.employee.dto.EmergencyContactRequest;
import com.hrms.employee.dto.EmergencyContactResponse;
import com.hrms.employee.dto.EmployeeResponse;
import com.hrms.employee.dto.EmployeeSummaryResponse;
import com.hrms.employee.dto.StaffOnboardingRequest;
import com.hrms.employee.dto.TerminationRequest;
import com.hrms.employee.dto.UpdateEmployeeRequest;
import com.hrms.employee.service.EmployeeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.EnumSet;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/employees")
@Tag(name = "Employees", description = "Employee master data and lifecycle management")
@SecurityRequirement(name = "bearerAuth")
public class EmployeeController {

    private static final EnumSet<Role> ADMIN_ROLES = EnumSet.of(
            Role.HR_MANAGER,
            Role.COMPANY_ADMIN,
            Role.SUPER_ADMIN
    );

    private static final EnumSet<Role> STAFF_ONBOARDING_ROLES = EnumSet.of(
            Role.EMPLOYEE,
            Role.DEPT_MANAGER
    );

    private final EmployeeService employeeService;
    private final AuthService authService;

    public EmployeeController(EmployeeService employeeService,
                              @Autowired(required = false) AuthService authService) {
        this.employeeService = employeeService;
        this.authService = authService;
    }

    @Operation(summary = "Create a new employee")
    @PostMapping
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<EmployeeResponse> create(@Valid @RequestBody CreateEmployeeRequest request) {
        EmployeeResponse employee = employeeService.createEmployee(request);
        if (authService != null) {
            authService.createOrUpdateCredentialForEmployee(
                    TenantContext.getTenantId(),
                    employee.id(),
                    employee.email(),
                    employee.phone(),
                    "Welcome@123",
                    List.of(Role.EMPLOYEE),
                    true);
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(employee);
    }

    @Operation(summary = "Create staff member with login role and temporary password")
    @PostMapping("/staff")
    @PreAuthorize("hasAnyRole('DEPT_MANAGER','HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<EmployeeResponse> createStaff(
            @Valid @RequestBody StaffOnboardingRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        List<Role> currentRoles = currentRoles(jwt);
        boolean adminRequest = hasAnyRole(currentRoles, ADMIN_ROLES);

        CreateEmployeeRequest employeeRequest = request.employee();
        List<Role> credentialRoles;

        if (adminRequest) {
            credentialRoles = normalizeAdminStaffRoles(request.roles());
        } else {
            EmployeeResponse manager = employeeService.getEmployee(extractEmployeeId(jwt));
            if (manager.departmentId() == null) {
                throw new BusinessRuleException(
                        "Manager must belong to a department before onboarding employees.",
                        "MANAGER_DEPARTMENT_REQUIRED");
            }
            employeeRequest = scopeToManager(employeeRequest, manager);
            credentialRoles = List.of(Role.EMPLOYEE);
        }

        EmployeeResponse employee = employeeService.createEmployee(employeeRequest);
        if (authService != null) {
            authService.createOrUpdateCredentialForEmployee(
                    TenantContext.getTenantId(),
                    employee.id(),
                    employee.email(),
                    employee.phone(),
                    temporaryPasswordOrDefault(request.temporaryPassword()),
                    credentialRoles,
                    request.biometricEnabled());
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(employee);
    }

    @Operation(summary = "Get current logged-in employee profile")
    @GetMapping("/me")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<EmployeeResponse> me(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(employeeService.getEmployee(extractEmployeeId(jwt)));
    }

    @Operation(summary = "Get employee by ID")
    @GetMapping("/{employeeId}")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER') or " +
                  "(hasRole('EMPLOYEE') and #employeeId == @securityHelper.currentEmployeeId())")
    public ResponseEntity<EmployeeResponse> get(@PathVariable UUID employeeId) {
        return ResponseEntity.ok(employeeService.getEmployee(employeeId));
    }

    @Operation(summary = "List employees by company (paginated)")
    @GetMapping("/company/{companyId}")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<PageResponse<EmployeeSummaryResponse>> listByCompany(
            @PathVariable UUID companyId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(employeeService.listEmployees(companyId, pageable));
    }

    @Operation(summary = "List employees by department")
    @GetMapping("/department/{departmentId}")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER')")
    public ResponseEntity<PageResponse<EmployeeSummaryResponse>> listByDepartment(
            @PathVariable UUID departmentId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(employeeService.listByDepartment(departmentId, pageable));
    }

    @Operation(summary = "Update employee details")
    @PutMapping("/{employeeId}")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<EmployeeResponse> update(
            @PathVariable UUID employeeId,
            @Valid @RequestBody UpdateEmployeeRequest request) {
        return ResponseEntity.ok(employeeService.updateEmployee(employeeId, request));
    }

    @Operation(summary = "Terminate or accept resignation of an employee")
    @PostMapping("/{employeeId}/terminate")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<Void> terminate(
            @PathVariable UUID employeeId,
            @Valid @RequestBody TerminationRequest request) {
        employeeService.terminateEmployee(employeeId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Add emergency contact for an employee")
    @PostMapping("/{employeeId}/emergency-contacts")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','EMPLOYEE')")
    public ResponseEntity<EmergencyContactResponse> addEmergencyContact(
            @PathVariable UUID employeeId,
            @Valid @RequestBody EmergencyContactRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(employeeService.addEmergencyContact(employeeId, request));
    }

    @Operation(summary = "Get emergency contacts for an employee")
    @GetMapping("/{employeeId}/emergency-contacts")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN') or " +
                  "(hasRole('EMPLOYEE') and #employeeId == @securityHelper.currentEmployeeId())")
    public ResponseEntity<List<EmergencyContactResponse>> getEmergencyContacts(
            @PathVariable UUID employeeId) {
        return ResponseEntity.ok(employeeService.getEmergencyContacts(employeeId));
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String employeeId = jwt.getClaimAsString("employee_id");
        return employeeId != null ? UUID.fromString(employeeId) : UUID.fromString(jwt.getSubject());
    }

    private List<Role> currentRoles(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        if (roles == null || roles.isEmpty()) {
            return List.of();
        }
        return roles.stream().map(Role::valueOf).toList();
    }

    private boolean hasAnyRole(List<Role> roles, EnumSet<Role> candidates) {
        return roles.stream().anyMatch(candidates::contains);
    }

    private List<Role> normalizeAdminStaffRoles(List<Role> requestedRoles) {
        if (requestedRoles == null || requestedRoles.isEmpty()) {
            return List.of(Role.EMPLOYEE);
        }
        boolean invalidRole = requestedRoles.stream().anyMatch(role -> !STAFF_ONBOARDING_ROLES.contains(role));
        if (invalidRole) {
            throw new BusinessRuleException(
                    "Staff onboarding can create employees or managers only.",
                    "INVALID_STAFF_ROLE");
        }
        if (requestedRoles.contains(Role.DEPT_MANAGER)) {
            return List.of(Role.EMPLOYEE, Role.DEPT_MANAGER);
        }
        return List.of(Role.EMPLOYEE);
    }

    private CreateEmployeeRequest scopeToManager(CreateEmployeeRequest request, EmployeeResponse manager) {
        return new CreateEmployeeRequest(
                request.firstName(),
                request.lastName(),
                request.middleName(),
                request.email(),
                request.personalEmail(),
                request.phone(),
                request.dateOfBirth(),
                request.gender(),
                manager.companyId(),
                manager.departmentId(),
                manager.branchId() != null ? manager.branchId() : request.branchId(),
                manager.id(),
                request.jobTitle(),
                request.employmentType(),
                request.dateOfJoining(),
                request.noticePeriodDays(),
                request.workLocation(),
                request.salaryFrequency(),
                request.monthlySalary(),
                request.panNumber(),
                request.aadhaarNumber(),
                request.uanNumber(),
                request.esiNumber(),
                request.bankAccountNumber(),
                request.bankIfscCode(),
                request.bankName(),
                request.bankBranchName(),
                request.onboardingTemplateId());
    }

    private String temporaryPasswordOrDefault(String temporaryPassword) {
        if (temporaryPassword == null || temporaryPassword.isBlank()) {
            return "Welcome@123";
        }
        return temporaryPassword;
    }
}
