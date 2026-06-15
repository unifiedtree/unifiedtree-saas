package com.hrms.api.employee;

import com.hrms.api.invitation.InvitationService;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.enums.Role;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
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

    private static final Logger log = LoggerFactory.getLogger(EmployeeController.class);

    private final EmployeeService employeeService;
    private final InvitationService invitationService;
    private final JdbcTemplate jdbcTemplate;

    public EmployeeController(EmployeeService employeeService,
                              @Autowired(required = false) InvitationService invitationService,
                              @Autowired(required = false) JdbcTemplate jdbcTemplate) {
        this.employeeService = employeeService;
        this.invitationService = invitationService;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Operation(summary = "Create a new employee")
    @PostMapping
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<EmployeeResponse> create(@Valid @RequestBody CreateEmployeeRequest request,
                                                   @AuthenticationPrincipal Jwt jwt) {
        EmployeeResponse employee = employeeService.createEmployee(request);
        queueInvite(employee, jwt);
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

        if (adminRequest) {
            // Just normalise admin-supplied roles for validation; the
            // canonical invitation flow only grants EMPLOYEE today — roles
            // beyond that come from a separate access-management screen.
            normalizeAdminStaffRoles(request.roles());
        } else {
            EmployeeResponse manager = employeeService.getEmployee(extractEmployeeId(jwt));
            if (manager.departmentId() == null) {
                throw new BusinessRuleException(
                        "Manager must belong to a department before onboarding employees.",
                        "MANAGER_DEPARTMENT_REQUIRED");
            }
            employeeRequest = scopeToManager(employeeRequest, manager);
        }

        EmployeeResponse employee = employeeService.createEmployee(employeeRequest);
        queueInvite(employee, jwt);
        return ResponseEntity.status(HttpStatus.CREATED).body(employee);
    }

    /**
     * Best-effort invitation send. Replaces the old default-password path
     * (which silently created a bcrypt(`Welcome@123`) credential — a known
     * preset password is a security liability). The canonical invitation
     * flow creates the credential with active=false / no password and
     * emails a single-use token; the employee picks their own password.
     */
    private void queueInvite(EmployeeResponse employee, Jwt jwt) {
        if (invitationService == null || jwt == null) return;
        if (employee.email() == null || employee.email().isBlank()) return;
        try {
            UUID actorId = UUID.fromString(jwt.getSubject());
            invitationService.sendInvitation(employee.id(), TenantContext.getTenantId(), actorId);
        } catch (RuntimeException ex) {
            log.warn("Invitation for {} (employee {}) failed to queue: {}",
                    employee.email(), employee.id(), ex.getMessage());
        }
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

    @Operation(summary = "Assign or clear the geofence zone an employee must punch in at")
    @PutMapping("/{employeeId}/punch-zone")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER')")
    public ResponseEntity<EmployeeResponse> assignPunchZone(
            @PathVariable UUID employeeId,
            @RequestParam(required = false) UUID zoneId) {
        // zoneId present -> assign that zone; omitted -> clear (company-wide / branch fallback).
        return ResponseEntity.ok(employeeService.assignPunchZone(employeeId, zoneId));
    }

    @Operation(summary = "Set an employee's weekly off days (CSV of ISO day numbers 1=Mon..7=Sun)")
    @PutMapping("/{employeeId}/weekly-offs")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER')")
    public ResponseEntity<EmployeeResponse> setWeeklyOffs(
            @PathVariable UUID employeeId,
            @RequestParam(required = false) String days) {
        // e.g. days=6,7 for Sat+Sun. Blank/omitted falls back to the Sat+Sun default.
        return ResponseEntity.ok(employeeService.setWeeklyOffDays(employeeId, days));
    }

    @Operation(summary = "Whether the employee has activated their account by setting a password")
    @GetMapping("/{employeeId}/invitation-status")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Map<String, Object>> invitationStatus(@PathVariable UUID employeeId) {
        // Source of truth: auth.user_credentials.password_hash + last_login_at.
        // employmentStatus is NOT a reliable signal (a freshly invited employee
        // is PROBATION/ACTIVE — neither "INVITED" nor "DRAFT" exists in the
        // enum) so the staff-profile UI used to lie ("Account activated" for
        // someone who never set their password). This endpoint returns the
        // accurate state so the UI can show Resend Invitation / Account
        // activated correctly.
        if (jdbcTemplate == null) {
            // Best-effort: in tests without JdbcTemplate, treat as inactive so
            // the UI defaults to "Resend invitation" (the safe, useful action).
            return ResponseEntity.ok(Map.of("activated", false, "invitedAt", "", "lastLoginAt", ""));
        }
        try {
            Map<String, Object> row = jdbcTemplate.queryForMap(
                    "SELECT (password_hash IS NOT NULL) AS activated, "
                            + "invited_at, last_login_at, is_active "
                            + "FROM auth.user_credentials WHERE employee_id = ? LIMIT 1",
                    employeeId);
            boolean activated = Boolean.TRUE.equals(row.get("activated"))
                    && Boolean.TRUE.equals(row.get("is_active"));
            Object invitedAt = row.get("invited_at");
            Object lastLoginAt = row.get("last_login_at");
            return ResponseEntity.ok(Map.of(
                    "activated", activated,
                    "invitedAt", invitedAt instanceof Instant i ? i.toString() : (invitedAt == null ? "" : invitedAt.toString()),
                    "lastLoginAt", lastLoginAt instanceof Instant i ? i.toString() : (lastLoginAt == null ? "" : lastLoginAt.toString())
            ));
        } catch (org.springframework.dao.EmptyResultDataAccessException ex) {
            // No credential row yet -> never invited / never activated.
            return ResponseEntity.ok(Map.of("activated", false, "invitedAt", "", "lastLoginAt", ""));
        }
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
        // The canonical-prod JWT may carry workspace roles like "OWNER" that are
        // not present in the legacy hrms Role enum. Silently skip unknowns so a
        // single unrecognised role string does not crash the whole handler.
        return roles.stream()
                .map(name -> {
                    try {
                        return Role.valueOf(name);
                    } catch (IllegalArgumentException ex) {
                        return null;
                    }
                })
                .filter(java.util.Objects::nonNull)
                .toList();
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
