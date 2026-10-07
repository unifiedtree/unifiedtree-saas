package com.hrms.api.leave;

import com.hrms.api.access.RecordCompanyGuard;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.hrms.core.dto.ListDateRange;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.leave.dto.LeaveApprovalRequest;
import com.hrms.leave.dto.LeaveBalanceResponse;
import com.hrms.leave.dto.LeaveOverviewResponse;
import com.hrms.leave.dto.LeaveRequestRequest;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.dto.LeaveTypeRequest;
import com.hrms.leave.dto.LeaveTypeResponse;
import com.hrms.leave.service.LeaveService;
import com.hrms.leave.service.LeaveTypeService;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/v1/leave")
@Tag(name = "Leave", description = "Leave applications, approvals, balances, and policies")
@SecurityRequirement(name = "bearerAuth")
public class LeaveController {

    /** Company access: a record addressed by id must be in a company the caller may work in (COMPANY_ACCESS.md). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private RecordCompanyGuard recordGuard;
    /** Company access: a company-scoped HR-level approver's tenant-wide lists cover their current company. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private CompanyAccessService companyAccess;

    private final LeaveService leaveService;
    private final LeaveTypeService leaveTypeService;
    private final EmployeeRepository employeeRepository;
    private final WorkforceDepartmentRepository departmentRepository;
    private final ApproverFallbackResolver approverFallbackResolver;
    @org.springframework.beans.factory.annotation.Autowired
    private com.hrms.api.attendance.ApproverScopeGuard approverScopeGuard;

    // HRMS redesign (27 Sep 2026). Field-injected so the constructor, which tests
    // and other packages build by hand, stays as it was; each is optional there.
    /** Row details (BW-38): approver and decider names, type code, balance, conflicts. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private LeaveRequestDetails details;
    /** "Approve all" (BW-42), one decision per request through the service proxy. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private LeaveBulkDecisions bulkDecisions;
    /** Tells the employee when someone applied for leave in their name (BW-43). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private LeaveOnBehalfNotifier onBehalfNotifier;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.unifiedtree.audit.AuditService auditService;

    public LeaveController(LeaveService leaveService,
                           LeaveTypeService leaveTypeService,
                           EmployeeRepository employeeRepository,
                           WorkforceDepartmentRepository departmentRepository,
                           ApproverFallbackResolver approverFallbackResolver) {
        this.leaveService = leaveService;
        this.leaveTypeService = leaveTypeService;
        this.employeeRepository = employeeRepository;
        this.departmentRepository = departmentRepository;
        this.approverFallbackResolver = approverFallbackResolver;
    }

    // ─── Employee self-service ───────────────────────────────────────────────

    @Operation(summary = "Apply for leave")
    @PostMapping("/apply")
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<LeaveRequestResponse> apply(
            @Valid @RequestBody LeaveRequestRequest request,
            @RequestParam(required = false) UUID companyId,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        UUID approverId = resolveApprover(employee);
        LeaveRequestResponse created = leaveService.applyLeave(
                employeeId,
                companyId != null ? companyId : employee.getCompanyId(),
                request,
                approverId);
        // Saved: record it in the audit log (best effort, never fails the request).
        if (auditService != null) {
            try {
                auditService.record("leave", "LEAVE_APPLIED", "LEAVE_REQUEST", created.id(),
                        "Applied for %s, %s to %s (%s day%s)".formatted(
                                created.leaveTypeName() != null ? created.leaveTypeName() : "leave",
                                created.startDate(), created.endDate(), days(created.totalDays()),
                                created.totalDays() == 1 ? "" : "s"));
            } catch (Exception e) {
                // Audit is best effort (AuditService also swallows its own write errors).
            }
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * The approver a leave request of {@code employee} goes to. The one chain
     * behind applying for yourself, applying on someone's behalf and the leave
     * preview, so all three always agree.
     */
    private UUID resolveApprover(Employee employee) {
        // Approver resolution chain (audit P0-1). The approval queue filters by
        // approver_id, so a null approver makes the request invisible to everyone —
        // the worst customer-facing bug on a fresh tenant. Resolve in order and
        // NEVER persist null:
        //   L1: the employee's explicit reporting manager
        //   L2: the employee's department head (resolved live, so a head set AFTER
        //       the employee was created still routes correctly)
        //   L3: any active HR_MANAGER in the tenant   ┐ terminal fallback so a tenant
        //   L4: any active SUPER_ADMIN in the tenant   ┘ that hasn't set up org structure
        //       still routes leave somewhere a human will see it
        // If even L4 fails, fail loudly at apply time so HR fixes the org structure
        // rather than the request silently rotting.
        // Never the applicant themself (audit 5 Oct 2026): a department head's
        // own leave goes on to HR, and the fallback is someone else when there is
        // anyone else. Nobody may decide their own request.
        UUID approverId = notThem(employee.getManagerId(), employee);
        if (approverId == null && employee.getDepartmentId() != null) {
            approverId = notThem(departmentRepository.findById(employee.getDepartmentId())
                    .map(com.hrms.employee.workforce.entity.Department::getDepartmentHeadEmployeeId)
                    .orElse(null), employee);
        }
        if (approverId == null) {
            approverId = approverFallbackResolver.resolveTerminalApprover(employee.getTenantId(), employee.getId())
                    .orElseThrow(() -> new BusinessRuleException(
                            "No approver available — assign this employee a reporting manager, set a "
                                    + "department head, or add an HR manager before applying for leave",
                            "NO_APPROVER_AVAILABLE"));
        }
        // Hard-validate that the resolved approver_id points at a real, active,
        // same-tenant employee. Without this, a stale UUID (e.g. an approver
        // that was set on the applicant record and later deleted, or a
        // cross-tenant mismatch caused by a picker bug) would be frozen into
        // leave_requests.approver_id and the request would silently rot in the
        // approval queue. If the primary chain resolved to something invalid,
        // fall through to the terminal fallback one more time so the request
        // still routes somewhere a human will see it.
        Employee resolvedApprover = employeeRepository.findById(approverId).orElse(null);
        if (!isValidApprover(resolvedApprover, employee)) {
            approverId = approverFallbackResolver.resolveTerminalApprover(employee.getTenantId(), employee.getId())
                    .orElseThrow(() -> new BusinessRuleException(
                            "Resolved approver is not a valid active employee in this tenant; "
                                    + "assign a reporting manager or department head before applying.",
                            "APPROVER_INVALID"));
            resolvedApprover = employeeRepository.findById(approverId).orElse(null);
            if (!isValidApprover(resolvedApprover, employee)) {
                throw new BusinessRuleException(
                        "No valid active approver could be resolved for this employee; "
                                + "please contact HR to set up the approval chain.",
                        "APPROVER_INVALID");
            }
        }
        // Redirect through any active delegation the resolved approver has set up:
        // "I'm on leave, my approvals go to Alice". Uses today rather than the
        // leave's start date so a Monday-approval delegation still covers a
        // request submitted today for next month.
        approverId = approverFallbackResolver.redirectIfDelegated(
                approverId, java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")));
        return approverId;
    }

    // ─── Apply on someone's behalf (HRMS redesign, BW-43) ───────────────────

    /** People who have left: nobody applies for leave for them. The same list as advance on behalf. */
    private static final java.util.Set<String> SEPARATED = java.util.Set.of("EXITED", "TERMINATED", "RESIGNED", "RETIRED");

    /**
     * HR, finance or an admin applies for leave in an employee's name. It is the
     * request the employee could make themselves: the same body, checks and
     * balance as {@link #apply}, filed under the employee's own company and sent
     * to the employee's usual approver (their chain, {@link #resolveApprover}).
     * Leave beyond the balance is refused as for anyone. Who applied is kept
     * (the request's {@code created_by}, shown as {@code raisedByName}) and
     * audited, and the employee is told ({@code leave.applied_on_behalf}).
     * Never for yourself: that is your own request.
     */
    @Operation(summary = "Apply for leave in an employee's name (HR / admin)")
    @PostMapping("/apply/for/{employeeId}")
    @PreAuthorize("@perm.check('hrms.leave.apply.others')")
    public ResponseEntity<LeaveRequestResponse> applyFor(
            @PathVariable UUID employeeId,
            @Valid @RequestBody LeaveRequestRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        RecordCompanyGuard.checkEmployee(recordGuard, employeeId);
        UUID caller = extractEmployeeId(jwt);
        if (employeeId.equals(caller)) {
            throw new BusinessRuleException(
                    "To apply for your own leave, use Apply.", "LEAVE_ON_BEHALF_SELF");
        }
        UUID tenantId = com.hrms.core.tenant.TenantContext.getTenantId();
        Employee employee = employeeRepository.findById(employeeId)
                .filter(e -> tenantId == null || tenantId.equals(e.getTenantId()))
                .orElseThrow(() -> new com.hrms.core.exception.ResourceNotFoundException("Employee", employeeId));
        if (employee.getEmploymentStatus() != null && SEPARATED.contains(employee.getEmploymentStatus().name())) {
            throw new BusinessRuleException(
                    "This employee has left the company, so leave can't be applied for them.", "LEAVE_EMPLOYEE_SEPARATED");
        }
        UUID typeCompany = leaveService.companyOfLeaveType(request.leaveTypeId());
        if (typeCompany != null && employee.getCompanyId() != null && !typeCompany.equals(employee.getCompanyId())) {
            throw new BusinessRuleException(
                    "That leave type belongs to another company. Choose one of this employee's leave types.",
                    "LEAVE_TYPE_OTHER_COMPANY");
        }
        UUID approverId = resolveApprover(employee);
        LeaveRequestResponse created = leaveService.applyLeave(employee.getId(), employee.getCompanyId(), request, approverId);

        // Saved and committed: record who did it and tell the employee. Neither can fail the request.
        String raisedBy = employeeRepository.findById(caller).map(LeaveController::fullName).orElse(null);
        String employeeName = fullName(employee);
        if (auditService != null) {
            try {
                auditService.record("leave", "LEAVE_APPLIED_ON_BEHALF", "LEAVE_REQUEST", created.id(),
                        "Applied for %s for %s, %s to %s (%s day%s)".formatted(
                                created.leaveTypeName() != null ? created.leaveTypeName() : "leave",
                                employeeName != null ? employeeName : employee.getId(),
                                created.startDate(), created.endDate(), days(created.totalDays()),
                                created.totalDays() == 1 ? "" : "s"));
            } catch (Exception e) {
                // Audit is best effort (AuditService also swallows its own write errors).
            }
        }
        if (onBehalfNotifier != null) {
            onBehalfNotifier.tellEmployee(employee.getTenantId(), employee.getId(), created.id(), raisedBy,
                    created.leaveTypeName(), created.startDate(), created.endDate());
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(enrichOne(created));
    }

    private static String days(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }

    // ─── Leave preview (HRMS redesign, BW-48) ───────────────────────────────

    /**
     * What applying for this leave would do, without applying: the working days
     * (counted as applying counts them), the balance before and after, who it
     * would go to, and every reason it would be refused, the first being the one
     * applying would answer with. Same company rule as {@link #apply}.
     */
    @Operation(summary = "Preview a leave request: working days, balance after, approver and anything that blocks it")
    @GetMapping("/preview")
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<com.hrms.leave.dto.LeavePreviewResponse> preview(
            @RequestParam UUID leaveTypeId,
            @RequestParam @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) java.time.LocalDate startDate,
            @RequestParam @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) java.time.LocalDate endDate,
            @RequestParam(required = false) com.hrms.leave.enums.LeaveDuration duration,
            @RequestParam(required = false) UUID companyId,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        LeaveRequestRequest request = new LeaveRequestRequest(leaveTypeId, startDate, endDate,
                duration != null ? duration : com.hrms.leave.enums.LeaveDuration.FULL_DAY, null);
        String approverName = null;
        com.hrms.leave.dto.LeavePreviewResponse.Refusal approverRefusal = null;
        try {
            UUID approverId = resolveApprover(employee);
            approverName = employeeRepository.findById(approverId).map(LeaveController::fullName).orElse(null);
        } catch (BusinessRuleException e) {
            approverRefusal = new com.hrms.leave.dto.LeavePreviewResponse.Refusal(e.getErrorCode(), e.getMessage());
        }
        return ResponseEntity.ok(leaveService.previewLeave(
                        employeeId, companyId != null ? companyId : employee.getCompanyId(), request)
                .withApprover(approverName, approverRefusal));
    }

    /** "First Last", never "First null"; null when there is no name. */
    static String fullName(Employee e) {
        if (e == null) return null;
        String n = (nz(e.getFirstName()) + " " + nz(e.getLastName())).trim();
        return n.isBlank() ? null : n;
    }

    @Operation(summary = "Mobile leave overview - balances, recent requests, and approval count")
    @GetMapping("/overview")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<LeaveOverviewResponse> overview(
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth,
            @RequestParam(defaultValue = "#{T(java.time.Year).now().value}") int year) {
        UUID employeeId = extractEmployeeId(jwt);
        ensureBalancesForEmployee(employeeId, year);
        List<LeaveBalanceResponse> balances = leaveService.getMyBalances(employeeId, year);
        PageResponse<LeaveRequestResponse> recent = leaveService.getMyLeaves(employeeId, Pageable.ofSize(5));
        // 2026-09-08 audit: this count ALWAYS used the reporting-manager-scoped
        // query, while GET /approvals/pending branches on the L2 authority and
        // returns the tenant-wide queue for admin/HR. So an OWNER or HR_MANAGER
        // saw "Pending Leaves 0" on the dashboard while the Approvals tab held
        // the real backlog — and the dashboard CTA then routed them to their
        // OWN leaves instead of the queue. Mirror the same branch here.
        boolean adminOrHr = auth != null && auth.getAuthorities().stream()
                .anyMatch(a -> "hrms.leave.approve.l2".equals(a.getAuthority()));
        UUID onlyCompany = adminOrHr ? CompanyAccessService.scopedViewCompanyId(companyAccess) : null;
        long pendingApprovals = (adminOrHr
                ? (onlyCompany == null ? leaveService.getAllPending(employeeId, Pageable.ofSize(1))
                        : leaveService.getAllPending(employeeId, onlyCompany, Pageable.ofSize(1)))
                : leaveService.getPendingApprovalsForManager(employeeId, Pageable.ofSize(1)))
                .totalElements();
        return ResponseEntity.ok(new LeaveOverviewResponse(balances, withDetails(recent.content(), false), pendingApprovals));
    }

    @Operation(summary = "Get my leave requests (optionally only leave whose days overlap ?from=&to=, India days, both included)")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<PageResponse<LeaveRequestResponse>> myLeaves(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        // Calendar everywhere (7 Oct 2026): no range = the list exactly as before.
        ListDateRange range = ListDateRange.parse(from, to);
        PageResponse<LeaveRequestResponse> page = range == null
                ? leaveService.getMyLeaves(extractEmployeeId(jwt), pageable)
                : leaveService.getMyLeaves(extractEmployeeId(jwt), range.from(), range.to(), pageable);
        // Who it went to, who decided and when, and who applied when HR did (BW-38, E9).
        return ResponseEntity.ok(new PageResponse<>(withDetails(page.content(), false), page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last()));
    }

    @Operation(summary = "Get my leave balances for a given year")
    @GetMapping("/my/balances")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<List<LeaveBalanceResponse>> myBalances(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "#{T(java.time.Year).now().value}") int year) {
        UUID employeeId = extractEmployeeId(jwt);
        ensureBalancesForEmployee(employeeId, year);
        return ResponseEntity.ok(leaveService.getMyBalances(employeeId, year));
    }

    /**
     * Read-time lazy creation of leave_balances rows. Without this, a freshly
     * onboarded employee whose hire-time init step never ran sees an empty
     * "Apply for Leave" screen ("No allocations yet") and cannot apply at all —
     * the mobile UI has no way to select a leave type when balances is [].
     * Idempotent: initLeaveBalances checks for existing rows per type before
     * inserting. Swallows exceptions so a transient init failure cannot 500 the
     * read; the worst case is the screen renders empty, same as the old code.
     */
    private void ensureBalancesForEmployee(UUID employeeId, int year) {
        try {
            employeeRepository.findById(employeeId).ifPresent(e -> {
                if (e.getCompanyId() != null && e.getTenantId() != null) {
                    leaveService.initLeaveBalances(employeeId, e.getCompanyId(), e.getTenantId(), year);
                }
            });
        } catch (Exception ex) {
            // Best-effort init; never break the read path.
        }
    }

    @Operation(summary = "Cancel a leave request")
    @PostMapping("/{requestId}/cancel")
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<Void> cancel(
            @PathVariable UUID requestId,
            @RequestParam String reason,
            @AuthenticationPrincipal Jwt jwt) {
        leaveService.cancelLeave(requestId, extractEmployeeId(jwt), reason);
        return ResponseEntity.noContent().build();
    }

    // ─── L1 Manager approval ────────────────────────────────────────────────

    @Operation(summary = "Get pending L1 leave approvals — broadens to ALL PENDING in tenant if caller has L2/HR authority")
    @GetMapping("/approvals/pending")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<PageResponse<LeaveRequestResponse>> pendingApprovals(
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth,
            @PageableDefault(size = 20) Pageable pageable) {
        // Admin / HR see EVERY pending request in the tenant, not just the ones
        // routed to them personally — a new hire with no reporting manager gets
        // routed to HR, and the admin needs to see it too. Detected by the
        // L2 approve authority (COMPANY_ADMIN + HR_MANAGER have it, plain
        // DEPT_MANAGER does not, so managers keep their personal-scope view).
        // Never their own requests, which they may not decide (audit 5 Oct 2026).
        boolean adminOrHr = auth != null && auth.getAuthorities().stream()
                .anyMatch(a -> "hrms.leave.approve.l2".equals(a.getAuthority()));
        // A company-scoped HR-level approver: their current company only (COMPANY_ACCESS.md).
        UUID onlyCompany = adminOrHr ? CompanyAccessService.scopedViewCompanyId(companyAccess) : null;
        PageResponse<LeaveRequestResponse> page = adminOrHr
                ? (onlyCompany == null ? leaveService.getAllPending(callerOrNull(jwt), pageable)
                        : leaveService.getAllPending(callerOrNull(jwt), onlyCompany, pageable))
                : leaveService.getPendingApprovalsForManager(extractEmployeeId(jwt), pageable);
        return ResponseEntity.ok(enrichPage(page, true));
    }

    /**
     * The Decided list with the redesign's segment counts (BW-40): the page as
     * before, plus {@code counts} per status over the same rows (so they always
     * add up to what the list can show), and an optional {@code status} filter.
     * Without {@code status} the page is exactly today's.
     */
    public record DecidedPage(List<LeaveRequestResponse> content, int page, int size, long totalElements,
                              int totalPages, boolean last, Map<String, Long> counts) {}

    /** Statuses the Decided list can be narrowed to: everything but PENDING. */
    static com.hrms.core.enums.ApprovalStatus decidedStatus(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            com.hrms.core.enums.ApprovalStatus s = com.hrms.core.enums.ApprovalStatus.valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
            if (s != com.hrms.core.enums.ApprovalStatus.PENDING) return s;
        } catch (IllegalArgumentException ignore) {
            // refused below
        }
        throw new com.hrms.core.exception.HrmsException(
                "Status must be APPROVED, REJECTED, CANCELLED or PENDING_L2.", HttpStatus.BAD_REQUEST, "INVALID_LEAVE_STATUS");
    }

    @Operation(summary = "Past leave decisions (approved/rejected/cancelled) — tenant-wide for HR/admin, personal scope for a manager")
    @GetMapping("/approvals/history")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<DecidedPage> approvalsHistory(
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth,
            @PageableDefault(size = 20) Pageable pageable,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        com.hrms.core.enums.ApprovalStatus only = decidedStatus(status);
        // Calendar everywhere (7 Oct 2026): optional ?from=&to=, leave whose days overlap them; none = as before.
        ListDateRange range = ListDateRange.parse(from, to);
        // Same admin/HR broadening as pendingApprovals above, and for the same
        // reason: this was personal-scope only, so an admin who is nobody's
        // reporting manager got an empty history and every decided leave in the
        // tenant became invisible the moment it left the pending queue.
        boolean adminOrHr = auth != null && auth.getAuthorities().stream()
                .anyMatch(a -> "hrms.leave.approve.l2".equals(a.getAuthority()));
        UUID me = extractEmployeeId(jwt);
        // A company-scoped HR-level approver: their current company only (COMPANY_ACCESS.md).
        UUID onlyCompany = adminOrHr ? CompanyAccessService.scopedViewCompanyId(companyAccess) : null;
        if (range != null) return ResponseEntity.ok(decidedInRange(adminOrHr ? null : me, onlyCompany, only, range, pageable));
        PageResponse<LeaveRequestResponse> page = adminOrHr && onlyCompany != null
                ? leaveService.getAllDecided(only, onlyCompany, pageable)
                : only == null
                ? (adminOrHr ? leaveService.getAllDecided(pageable) : leaveService.getDecidedApprovalsForManager(me, pageable))
                : (adminOrHr ? leaveService.getAllDecided(only, pageable) : leaveService.getDecidedApprovalsForManager(me, only, pageable));
        PageResponse<LeaveRequestResponse> enriched = enrichPage(page, false);
        Map<String, Long> counts;
        try {
            counts = onlyCompany != null ? leaveService.decidedCounts(null, onlyCompany)
                    : leaveService.decidedCounts(adminOrHr ? null : me);
        } catch (org.springframework.dao.DataAccessException e) {
            counts = null; // the list still works without its counts
        }
        return ResponseEntity.ok(new DecidedPage(enriched.content(), enriched.page(), enriched.size(),
                enriched.totalElements(), enriched.totalPages(), enriched.last(), counts));
    }

    /** {@link #approvalsHistory} for a range of days: the same scope (a manager's, else HR's, maybe one company), counts over the same rows. */
    private DecidedPage decidedInRange(UUID manager, UUID company, com.hrms.core.enums.ApprovalStatus only,
                                       ListDateRange range, Pageable pageable) {
        PageResponse<LeaveRequestResponse> enriched = enrichPage(
                leaveService.getDecidedOverlapping(manager, company, only, range.from(), range.to(), pageable), false);
        Map<String, Long> counts;
        try {
            counts = leaveService.decidedCountsOverlapping(manager, company, range.from(), range.to());
        } catch (org.springframework.dao.DataAccessException e) {
            counts = null; // the list still works without its counts
        }
        return new DecidedPage(enriched.content(), enriched.page(), enriched.size(),
                enriched.totalElements(), enriched.totalPages(), enriched.last(), counts);
    }

    @Operation(summary = "L1 manager approval — approve escalates to HR, reject closes")
    @PostMapping("/{requestId}/l1-decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<LeaveRequestResponse> decideL1(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth) {
        approverScopeGuard.assertCanDecideFor(leaveService.requesterOf(requestId), jwt, auth);
        return ResponseEntity.ok(enrichOne(leaveService.approveL1(requestId, extractEmployeeId(jwt), approval)));
    }

    // ─── L2 HR approval ─────────────────────────────────────────────────────

    @Operation(summary = "Get leave requests awaiting L2 HR approval")
    @GetMapping("/approvals/pending-l2")
    @PreAuthorize("@perm.check('hrms.leave.approve.l2')")
    public ResponseEntity<PageResponse<LeaveRequestResponse>> pendingL2Approvals(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        // Not the caller's own requests, which they may not decide (audit 5 Oct 2026).
        // A company-scoped HR-level approver: their current company only (COMPANY_ACCESS.md).
        UUID onlyCompany = CompanyAccessService.scopedViewCompanyId(companyAccess);
        return ResponseEntity.ok(enrichPage(onlyCompany == null
                ? leaveService.getPendingL2Approvals(callerOrNull(jwt), pageable)
                : leaveService.getPendingL2Approvals(callerOrNull(jwt), onlyCompany, pageable), true));
    }

    @Operation(summary = "L2 HR final approval or rejection")
    @PostMapping("/{requestId}/l2-decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l2')")
    public ResponseEntity<LeaveRequestResponse> decideL2(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth) {
        approverScopeGuard.assertCanDecideFor(leaveService.requesterOf(requestId), jwt, auth);
        return ResponseEntity.ok(enrichOne(leaveService.approveL2(requestId, extractEmployeeId(jwt), approval)));
    }

    @Operation(summary = "Approve or reject a leave request (legacy single-step)")
    @PostMapping("/{requestId}/decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<LeaveRequestResponse> decide(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth) {
        approverScopeGuard.assertCanDecideFor(leaveService.requesterOf(requestId), jwt, auth);
        return ResponseEntity.ok(enrichOne(leaveService.approveLeave(requestId, extractEmployeeId(jwt), approval)));
    }

    /** What "Approve all" sends: the requests, one decision for all of them, and an optional note. */
    public record BulkDecisionRequest(
            @jakarta.validation.constraints.NotEmpty(message = "Choose at least one leave request") List<UUID> ids,
            @jakarta.validation.constraints.NotNull(message = "Status is required") com.hrms.core.enums.ApprovalStatus status,
            @jakarta.validation.constraints.Size(max = 1000, message = "Keep the note under 1000 characters") String comment) {}

    /**
     * Decide several leave requests at once (HRMS redesign, BW-42): exactly
     * {@link #decide} for each one (team scope, then the single-step decision
     * with its own checks), each in its own transaction, with a result per
     * request. One refused request doesn't stop or undo the others.
     */
    @Operation(summary = "Approve or reject several leave requests at once; a result per request")
    @PostMapping("/approvals/bulk-decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<LeaveBulkDecisions.Outcome> bulkDecide(
            @Valid @RequestBody BulkDecisionRequest body,
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth) {
        if (bulkDecisions == null) {
            throw new com.hrms.core.exception.HrmsException("Deciding several requests at once isn't available.",
                    HttpStatus.SERVICE_UNAVAILABLE, "FEATURE_NOT_READY");
        }
        return ResponseEntity.ok(bulkDecisions.decide(body.ids(), body.status(), body.comment(),
                extractEmployeeId(jwt), jwt, auth));
    }

    // ─── Leave type admin ────────────────────────────────────────────────────

    @Operation(summary = "Create a leave type for a company")
    @PostMapping("/types")
    @PreAuthorize("hasAuthority('leave.type.write')")
    public ResponseEntity<LeaveTypeResponse> createType(
            @Valid @RequestBody LeaveTypeRequest request,
            @RequestParam UUID companyId) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(leaveTypeService.createLeaveType(companyId, request));
    }

    @Operation(summary = "List leave types for a company")
    @GetMapping("/types")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<LeaveTypeResponse>> listTypes(@RequestParam UUID companyId) {
        return ResponseEntity.ok(leaveTypeService.listLeaveTypes(companyId));
    }

    @Operation(summary = "Update a leave type")
    @PutMapping("/types/{id}")
    @PreAuthorize("hasAuthority('leave.type.write')")
    public ResponseEntity<LeaveTypeResponse> updateType(
            @PathVariable UUID id,
            @Valid @RequestBody LeaveTypeRequest request) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.LEAVE_TYPE, id);
        return ResponseEntity.ok(leaveTypeService.updateLeaveType(id, request));
    }

    @Operation(summary = "Deactivate (soft-delete) a leave type")
    @DeleteMapping("/types/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('leave.type.write')")
    public void deactivateType(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.LEAVE_TYPE, id);
        leaveTypeService.deactivateLeaveType(id);
    }

    // ─── Requester identity enrichment ───────────────────────────────────────
    // The leave module has no dependency on hrms-employee, so the requester's
    // name / code / department are resolved here (the API layer) and folded into
    // the response DTO so manager/admin approval cards can show WHOSE request it is.

    /** Row details (BW-38); rows unchanged when the lookup isn't available. */
    private List<LeaveRequestResponse> withDetails(List<LeaveRequestResponse> rows, boolean withConflicts) {
        return details == null ? rows : details.apply(rows, withConflicts);
    }

    private PageResponse<LeaveRequestResponse> enrichPage(PageResponse<LeaveRequestResponse> page, boolean withConflicts) {
        List<UUID> employeeIds = page.content().stream()
                .map(LeaveRequestResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        Map<UUID, String> departmentNames = departmentNames(employeeMap.values());
        List<LeaveRequestResponse> enriched = withDetails(page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId()), departmentNames))
                .toList(), withConflicts);
        return new PageResponse<>(
                enriched, page.page(), page.size(), page.totalElements(), page.totalPages(), page.last());
    }

    private LeaveRequestResponse enrichOne(LeaveRequestResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        Map<UUID, String> departmentNames = employee != null
                ? departmentNames(List.of(employee))
                : Map.of();
        LeaveRequestResponse named = enrich(r, employee, departmentNames);
        return details == null ? named : details.applyOne(named, false);
    }

    private LeaveRequestResponse enrich(LeaveRequestResponse r,
                                        Employee employee,
                                        Map<UUID, String> departmentNames) {
        // Null-safe join: a null last name must render as "Anil", never
        // "Anil null" (Java concatenates a null reference as the text "null").
        String employeeName = employee != null
                ? ((nz(employee.getFirstName()) + " " + nz(employee.getLastName())).trim())
                : null;
        if (employeeName != null && employeeName.isBlank()) employeeName = null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        String departmentName = employee != null && employee.getDepartmentId() != null
                ? departmentNames.get(employee.getDepartmentId())
                : null;
        return r.withRequester(employeeName, employeeCode, departmentName);
    }

    /** Null/blank-safe string: turns a null into "" so name joins never emit the text "null". */
    private static String nz(String s) {
        return s == null ? "" : s.trim();
    }

    private Map<UUID, String> departmentNames(java.util.Collection<Employee> employees) {
        List<UUID> departmentIds = employees.stream()
                .map(Employee::getDepartmentId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (departmentIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> names = new HashMap<>();
        departmentRepository.findAllById(departmentIds)
                .forEach(department -> names.put(department.getId(), department.getName()));
        return names;
    }

    /**
     * A resolved approver is valid when it points at a real employee in the
     * same tenant as the applicant, and the employee's employment status is
     * not one of the terminal / inactive states (EXITED / TERMINATED /
     * RESIGNED / RETIRED / SUSPENDED). This defends against stale approver
     * UUIDs left behind after HR terminates a manager but the org tree
     * hasn't been re-linked yet.
     */
    private boolean isValidApprover(Employee approver, Employee applicant) {
        if (approver == null || applicant == null) return false;
        if (approver.getTenantId() == null || !approver.getTenantId().equals(applicant.getTenantId())) {
            return false;
        }
        EmploymentStatus status = approver.getEmploymentStatus();
        if (status == null) return true; // legacy rows: assume active
        switch (status) {
            case EXITED:
            case TERMINATED:
            case RESIGNED:
            case RETIRED:
            case SUSPENDED:
                return false;
            default:
                return true;
        }
    }

    /** {@code approverId}, or null when it is the applicant themself. */
    private static UUID notThem(UUID approverId, Employee applicant) {
        return approverId != null && approverId.equals(applicant.getId()) ? null : approverId;
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

    /**
     * The caller, for leaving their own requests out of an HR / admin queue;
     * null (nothing left out, the queue as before) when the token doesn't say.
     */
    private UUID callerOrNull(Jwt jwt) {
        try {
            return jwt == null ? null : extractEmployeeId(jwt);
        } catch (RuntimeException unreadable) {
            return null;
        }
    }

}
