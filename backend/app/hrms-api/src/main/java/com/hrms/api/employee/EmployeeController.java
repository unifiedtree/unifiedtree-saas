package com.hrms.api.employee;

import com.hrms.api.access.WorkspaceAccessService;
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
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/v1/employees")
@Tag(name = "Employees", description = "Employee master data and lifecycle management")
@SecurityRequirement(name = "bearerAuth")
public class EmployeeController {

    // Permissions, not role names, decide who may do what here (V143.17). The
    // built-in roles that used to pass by name hold exactly these:
    //   hrms.employee.write       HR_MANAGER, ADMIN, OWNER, SUPER_ADMIN
    //   hrms.employee.read        the same, plus FINANCE_LEAD (who already reads
    //                             every record through /v1/hrms/employees)
    //   hrms.employee.team.manage DEPT_MANAGER (+ OWNER, SUPER_ADMIN): their own
    //                             team only, enforced by the object checks below
    static final String EMPLOYEE_WRITE = "hrms.employee.write";
    static final String EMPLOYEE_READ = "hrms.employee.read";
    static final String TEAM_MANAGE = "hrms.employee.team.manage";

    private static final EnumSet<Role> STAFF_ONBOARDING_ROLES = EnumSet.of(
            Role.EMPLOYEE,
            Role.DEPT_MANAGER
    );

    private static final Logger log = LoggerFactory.getLogger(EmployeeController.class);

    private final EmployeeService employeeService;
    private final InvitationService invitationService;
    private final JdbcTemplate jdbcTemplate;
    private final WorkspaceAccessService accessService;

    public EmployeeController(EmployeeService employeeService,
                              @Autowired(required = false) InvitationService invitationService,
                              @Autowired(required = false) JdbcTemplate jdbcTemplate,
                              @Autowired(required = false) WorkspaceAccessService accessService) {
        this.employeeService = employeeService;
        this.invitationService = invitationService;
        this.jdbcTemplate = jdbcTemplate;
        this.accessService = accessService;
    }

    @Operation(summary = "Create a new employee")
    @PostMapping
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public ResponseEntity<EmployeeResponse> create(@Valid @RequestBody CreateEmployeeRequest request,
                                                   @AuthenticationPrincipal Jwt jwt) {
        // Per-seat pricing is only real if somebody checks it. The seat-quota
        // enforcement now lives inside EmployeeService.createEmployee itself
        // so every code path that creates an employee — this controller, the
        // /staff variant below, and the CSV bulk importer — shares a single
        // rule and cannot be bypassed by picking a different endpoint.
        EmployeeResponse employee = employeeService.createEmployee(request);
        queueInvite(employee, jwt);
        return ResponseEntity.status(HttpStatus.CREATED).body(employee);
    }

    @Operation(summary = "Create staff member with login role and temporary password")
    @PostMapping("/staff")
    @PreAuthorize("hasAnyAuthority('hrms.employee.write','hrms.employee.team.manage')")
    public ResponseEntity<EmployeeResponse> createStaff(
            @Valid @RequestBody StaffOnboardingRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        // Seat-quota enforcement is inside EmployeeService.createEmployee, so
        // both /employees and /employees/staff share one gate.
        // Company-wide create for HR / admins; a department manager adds staff
        // only to their own department (scopeToManager below).
        boolean adminRequest = hasPermission(EMPLOYEE_WRITE);

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
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<EmployeeResponse> get(@PathVariable UUID employeeId,
                                                @AuthenticationPrincipal Jwt jwt) {
        // B2 FIX (audit 2026-08-15): object-scope IDOR guard: (a) self,
        // (b) a department manager (hrms.employee.team.manage) for their direct
        // report, or (c) whoever holds hrms.employee.read.
        assertCanAccessEmployee(jwt, employeeId, EMPLOYEE_READ, ManagerAccess.WITH_TEAM_PERMISSION);
        return ResponseEntity.ok(employeeService.getEmployee(employeeId));
    }

    // ---- B2 IDOR helper ------------------------------------------------------

    /** When a direct manager may act on their report's record. */
    enum ManagerAccess {
        /** Never (only self or the company-wide permission). */
        NONE,
        /** Any direct manager (the endpoint is open to every signed-in user). */
        ANY,
        /** A direct manager who holds hrms.employee.team.manage. */
        WITH_TEAM_PERMISSION
    }

    /**
     * Object-scope IDOR guard. Caller passes access iff any of:
     *  <ul>
     *   <li>SELF — jwt.employee_id equals {@code targetEmployeeId}</li>
     *   <li>COMPANY-WIDE — caller holds {@code companyWidePermission}</li>
     *   <li>DIRECT MANAGER — target employee's reporting_manager_id equals
     *       jwt.employee_id, as {@code managerAccess} allows</li>
     *  </ul>
     * Otherwise throws AccessDeniedException — 403 back to caller. Permission
     * based (V143.17): it used to let HR_MANAGER / OWNER / ADMIN / SUPER_ADMIN
     * through by role name, which Roles &amp; permissions could never close.
     */
    private void assertCanAccessEmployee(Jwt jwt, UUID targetEmployeeId,
                                         String companyWidePermission, ManagerAccess managerAccess) {
        if (jwt == null || targetEmployeeId == null) {
            throw new org.springframework.security.access.AccessDeniedException("forbidden");
        }
        UUID caller = extractEmployeeId(jwt);
        if (targetEmployeeId.equals(caller)) return;
        if (hasPermission(companyWidePermission)) return;

        boolean managerAllowed = managerAccess == ManagerAccess.ANY
                || (managerAccess == ManagerAccess.WITH_TEAM_PERMISSION && hasPermission(TEAM_MANAGE));
        // Direct-manager: target.reporting_manager_id == caller
        if (managerAllowed && jdbcTemplate != null) {
            try {
                UUID mgr = jdbcTemplate.queryForObject(
                        "SELECT reporting_manager_id FROM hrms.employees WHERE id = ?",
                        UUID.class, targetEmployeeId);
                if (mgr != null && mgr.equals(caller)) return;
            } catch (org.springframework.dao.EmptyResultDataAccessException ignored) {
                // no such row → deny
            } catch (Exception e) {
                log.warn("IDOR guard: manager lookup failed for {} — denying: {}",
                        targetEmployeeId, e.getMessage());
            }
        }
        throw new org.springframework.security.access.AccessDeniedException(
                "You are not authorised to access this employee's data");
    }

    @Operation(summary = "List employees by company (paginated)")
    @GetMapping("/company/{companyId}")
    @PreAuthorize("hasAuthority('hrms.employee.read')")
    public ResponseEntity<PageResponse<EmployeeSummaryResponse>> listByCompany(
            @PathVariable UUID companyId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(employeeService.listEmployees(companyId, pageable));
    }

    @Operation(summary = "List employees by department")
    @GetMapping("/department/{departmentId}")
    @PreAuthorize("hasAnyAuthority('hrms.employee.read','hrms.employee.team.manage')")
    public ResponseEntity<PageResponse<EmployeeSummaryResponse>> listByDepartment(
            @PathVariable UUID departmentId,
            @PageableDefault(size = 20) Pageable pageable,
            @AuthenticationPrincipal Jwt jwt) {
        // A department manager may only list a department they lead or belong to.
        // Without this the endpoint returned every department's roster
        // (names, emails, probation status) to any manager. Uses a raw JDBC
        // check to avoid dragging the workforce repo into this module.
        boolean isAdminLike = hasPermission(EMPLOYEE_READ);
        if (!isAdminLike && jdbcTemplate != null) {
            UUID actor = extractEmployeeId(jwt);
            try {
                Boolean allowed = jdbcTemplate.queryForObject(
                        "SELECT EXISTS ("
                                + " SELECT 1 FROM hrms.departments d "
                                + " LEFT JOIN hrms.employees e ON e.id = ? "
                                + " WHERE d.id = ? AND (d.department_head_employee_id = ? OR e.department_id = d.id)"
                                + ")",
                        Boolean.class, actor, departmentId, actor);
                if (!Boolean.TRUE.equals(allowed)) {
                    throw new org.springframework.security.access.AccessDeniedException(
                            "You can list only your own team's departments.");
                }
            } catch (org.springframework.security.access.AccessDeniedException ade) {
                throw ade;
            } catch (Exception ex) {
                log.warn("dept-scope lookup failed for {}: {}", departmentId, ex.getMessage());
                throw new org.springframework.security.access.AccessDeniedException("dept-scope check failed");
            }
        }
        return ResponseEntity.ok(employeeService.listByDepartment(departmentId, pageable));
    }

    @Operation(summary = "Update employee details")
    @PutMapping("/{employeeId}")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public ResponseEntity<EmployeeResponse> update(
            @PathVariable UUID employeeId,
            @Valid @RequestBody UpdateEmployeeRequest request) {
        return ResponseEntity.ok(employeeService.updateEmployee(employeeId, request));
    }

    @Operation(summary = "Assign or clear the geofence zone an employee must punch in at")
    @PutMapping("/{employeeId}/punch-zone")
    @PreAuthorize("hasAnyAuthority('hrms.employee.write','hrms.employee.team.manage')")
    public ResponseEntity<EmployeeResponse> assignPunchZone(
            @PathVariable UUID employeeId,
            @RequestParam(required = false) UUID zoneId,
            @AuthenticationPrincipal Jwt jwt) {
        // zoneId present -> assign that zone; omitted -> clear (company-wide / branch fallback).
        assertCanAccessEmployee(jwt, employeeId, EMPLOYEE_WRITE, ManagerAccess.WITH_TEAM_PERMISSION);
        return ResponseEntity.ok(employeeService.assignPunchZone(employeeId, zoneId));
    }

    @Operation(summary = "Set an employee's weekly off days (CSV of ISO day numbers 1=Mon..7=Sun)")
    @PutMapping("/{employeeId}/weekly-offs")
    @PreAuthorize("hasAnyAuthority('hrms.employee.write','hrms.employee.team.manage')")
    public ResponseEntity<EmployeeResponse> setWeeklyOffs(
            @PathVariable UUID employeeId,
            @RequestParam(required = false) String days,
            @AuthenticationPrincipal Jwt jwt) {
        // e.g. days=6,7 for Sat+Sun. Blank/omitted falls back to the Sat+Sun default.
        assertCanAccessEmployee(jwt, employeeId, EMPLOYEE_WRITE, ManagerAccess.WITH_TEAM_PERMISSION);
        return ResponseEntity.ok(employeeService.setWeeklyOffDays(employeeId, days));
    }

    @Operation(summary = "Read the employee's elevated role (EMPLOYEE, DEPT_MANAGER, HR_MANAGER, COMPANY_ADMIN)")
    @GetMapping("/{employeeId}/access")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Map<String, Object>> getAccess(@PathVariable UUID employeeId,
                                                        @AuthenticationPrincipal Jwt jwt) {
        assertCanAccessEmployee(jwt, employeeId, EMPLOYEE_READ, ManagerAccess.ANY);
        // Reads the highest-tier role on the employee's credential. Used by the
        // mobile Staff Profile to show "Role: Department Manager" alongside the
        // existing Account-Activated panel.
        if (jdbcTemplate == null) {
            return ResponseEntity.ok(Map.of("role", "EMPLOYEE", "roles", List.of("EMPLOYEE")));
        }
        try {
            List<String> roles = jdbcTemplate.queryForList(
                    "SELECT r.code FROM rbac.user_roles ur "
                            + "JOIN rbac.roles r ON r.id = ur.role_id "
                            + "JOIN auth.user_credentials uc ON uc.id = ur.user_id "
                            + "WHERE uc.employee_id = ?",
                    String.class, employeeId);
            // Priority: COMPANY_ADMIN > HR_MANAGER > DEPT_MANAGER > EMPLOYEE
            String top = roles.contains("COMPANY_ADMIN") ? "COMPANY_ADMIN"
                    : roles.contains("HR_MANAGER") ? "HR_MANAGER"
                    : roles.contains("DEPT_MANAGER") ? "DEPT_MANAGER"
                    : "EMPLOYEE";
            return ResponseEntity.ok(Map.of("role", top, "roles", roles));
        } catch (Exception ex) {
            return ResponseEntity.ok(Map.of("role", "EMPLOYEE", "roles", List.of("EMPLOYEE")));
        }
    }

    @Operation(summary = "Set the employee's elevated role (promote to Manager, demote, etc.)")
    @PutMapping("/{employeeId}/access")
    @PreAuthorize("hasAuthority('workspace.users.manage')")
    public ResponseEntity<Map<String, Object>> setAccess(
            @PathVariable UUID employeeId,
            @RequestParam String role,
            // Optional: when promoting to DEPT_MANAGER, admin picks WHICH department
            // this employee leads. If provided, we also set the department's
            // department_head_employee_id to this employee (co-existing heads:
            // the confirmation dialog on the mobile side already surfaced the
            // existing head, so replacement here is intentional and audited).
            @RequestParam(value = "departmentId", required = false) UUID departmentId,
            @AuthenticationPrincipal Jwt jwt) {
        // Allowed targets. We deliberately exclude OWNER/SUPER_ADMIN — those are
        // platform-level roles, only assignable via the web SaaS portal.
        Set<String> allowed = Set.of("EMPLOYEE", "DEPT_MANAGER", "HR_MANAGER", "COMPANY_ADMIN");
        if (!allowed.contains(role)) {
            throw new BusinessRuleException(
                    "Role must be one of: " + allowed, "INVALID_ROLE");
        }
        if (jdbcTemplate == null || accessService == null) {
            throw new BusinessRuleException(
                    "Role assignment is not configured on this deployment.", "ACCESS_UNAVAILABLE");
        }
        // Look up credential by employeeId.
        UUID userId;
        try {
            userId = jdbcTemplate.queryForObject(
                    "SELECT id FROM auth.user_credentials WHERE employee_id = ? LIMIT 1",
                    UUID.class, employeeId);
        } catch (org.springframework.dao.EmptyResultDataAccessException ex) {
            throw new BusinessRuleException(
                    "This employee has no login credential yet — send them an invite first.",
                    "NO_CREDENTIAL");
        }
        UUID tenantId = TenantContext.getTenantId();
        UUID actorId = UUID.fromString(jwt.getSubject());

        // Step 1: revoke any of the four mutable roles the employee currently holds.
        List<String> existing = jdbcTemplate.queryForList(
                "SELECT r.code FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id "
                        + "WHERE ur.user_id = ?",
                String.class, userId);
        for (String code : List.of("DEPT_MANAGER", "HR_MANAGER", "COMPANY_ADMIN")) {
            if (existing.contains(code)) {
                try { accessService.revokeRole(tenantId, userId, code, actorId); }
                catch (Exception ignored) { /* tolerate already-removed */ }
            }
        }
        // Always keep EMPLOYEE so login still works; assignRole is idempotent.
        if (!existing.contains("EMPLOYEE")) {
            try { accessService.assignRole(tenantId, userId, "EMPLOYEE", actorId); }
            catch (Exception ignored) { /* tolerate */ }
        }
        // Step 2: assign the requested elevated role (no-op for EMPLOYEE).
        if (!"EMPLOYEE".equals(role)) {
            accessService.assignRole(tenantId, userId, role, actorId);
        }
        // Step 3: if promoting to DEPT_MANAGER with an explicit department,
        // set that department's head to this employee. Skipped for other
        // roles and when no departmentId provided.
        if ("DEPT_MANAGER".equals(role) && departmentId != null) {
            try {
                jdbcTemplate.update(
                        "UPDATE hrms.departments SET department_head_employee_id = ? "
                                + "WHERE id = ? AND tenant_id = ?",
                        employeeId, departmentId, tenantId);
            } catch (Exception e) {
                // Non-fatal: the role IS assigned, just log — admin can retry the head-set.
                // Not throwing keeps the primary role change idempotent.
            }
        }
        return ResponseEntity.ok(Map.of("role", role));
    }

    @Operation(summary = "Whether the employee has activated their account by setting a password")
    @GetMapping("/{employeeId}/invitation-status")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Map<String, Object>> invitationStatus(@PathVariable UUID employeeId,
                                                                @AuthenticationPrincipal Jwt jwt) {
        assertCanAccessEmployee(jwt, employeeId, EMPLOYEE_READ, ManagerAccess.ANY);
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
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public ResponseEntity<Void> terminate(
            @PathVariable UUID employeeId,
            @Valid @RequestBody TerminationRequest request) {
        employeeService.terminateEmployee(employeeId, request);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Add emergency contact for an employee")
    @PostMapping("/{employeeId}/emergency-contacts")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<EmergencyContactResponse> addEmergencyContact(
            @PathVariable UUID employeeId,
            @Valid @RequestBody EmergencyContactRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        // Self, a direct manager (as before), or whoever holds hrms.employee.write.
        assertCanAccessEmployee(jwt, employeeId, EMPLOYEE_WRITE, ManagerAccess.ANY);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(employeeService.addEmergencyContact(employeeId, request));
    }

    @Operation(summary = "Get emergency contacts for an employee")
    @GetMapping("/{employeeId}/emergency-contacts")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<EmergencyContactResponse>> getEmergencyContacts(
            @PathVariable UUID employeeId,
            @AuthenticationPrincipal Jwt jwt) {
        // Self, or whoever holds hrms.employee.read (managers never could).
        assertCanAccessEmployee(jwt, employeeId, EMPLOYEE_READ, ManagerAccess.NONE);
        return ResponseEntity.ok(employeeService.getEmergencyContacts(employeeId));
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String employeeId = jwt.getClaimAsString("employee_id");
        return employeeId != null ? UUID.fromString(employeeId) : UUID.fromString(jwt.getSubject());
    }

    /** Whether the signed-in principal holds this permission (JWT authorities). */
    static boolean hasPermission(String permission) {
        var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || permission == null) return false;
        for (var ga : auth.getAuthorities()) {
            if (permission.equals(ga.getAuthority())) return true;
        }
        return false;
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
