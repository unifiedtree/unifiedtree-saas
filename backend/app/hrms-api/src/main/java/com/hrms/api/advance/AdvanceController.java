package com.hrms.api.advance;

import com.hrms.advance.dto.AdvanceDecisionRequest;
import com.hrms.advance.dto.AdvanceRequestCreateRequest;
import com.hrms.advance.dto.AdvanceResponse;
import com.hrms.advance.enums.AdvanceStatus;
import com.hrms.advance.service.AdvanceService;
import com.hrms.core.dto.PageResponse;
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

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Salary advances: employee self-service requests, manager/HR approval, and
 * finance disbursement.
 */
@RestController
@RequestMapping("/v1/advance")
@Tag(name = "Advance", description = "Salary advance requests, approvals, and disbursement")
@SecurityRequirement(name = "bearerAuth")
public class AdvanceController {

    private final AdvanceService advanceService;
    private final EmployeeRepository employeeRepository;
    private final AdvanceRecoveryService advanceRecoveryService;
    private final com.hrms.api.leave.ApproverFallbackResolver approverFallback;
    private final AdvanceReadService reads;
    private final WorkforceDepartmentRepository departmentRepository;
    private final com.hrms.api.payroll.PayrollService payrollService;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public AdvanceController(AdvanceService advanceService,
                            EmployeeRepository employeeRepository,
                            AdvanceRecoveryService advanceRecoveryService,
                            com.hrms.api.leave.ApproverFallbackResolver approverFallback,
                            AdvanceReadService reads,
                            WorkforceDepartmentRepository departmentRepository,
                            com.hrms.api.payroll.PayrollService payrollService,
                            org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.advanceService = advanceService;
        this.employeeRepository = employeeRepository;
        this.advanceRecoveryService = advanceRecoveryService;
        this.approverFallback = approverFallback;
        this.reads = reads;
        this.departmentRepository = departmentRepository;
        this.payrollService = payrollService;
        this.jdbc = jdbc;
    }

    // ─── Employee self-service ───────────────────────────────────────────────

    @Operation(summary = "Raise a salary advance request")
    @PostMapping("/requests")
    @PreAuthorize("hasAuthority('hrms.advance.request.self')")
    public ResponseEntity<AdvanceResponse> request(
            @Valid @RequestBody AdvanceRequestCreateRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        UUID companyId = employee.getCompanyId();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(advanceService.requestAdvance(employeeId, companyId, request, resolveApprover(employee))));
    }

    /** What HR / finance send to raise an advance in an employee's name. */
    public record AdvanceOnBehalfRequest(
            @jakarta.validation.constraints.NotNull(message = "Choose the employee") UUID employeeId,
            @jakarta.validation.constraints.NotNull
            @jakarta.validation.constraints.DecimalMin(value = "0.01", message = "Advance amount must be greater than zero")
            java.math.BigDecimal amount,
            @jakarta.validation.constraints.Size(max = 500, message = "Keep the reason under 500 characters") String reason,
            @jakarta.validation.constraints.NotNull
            @jakarta.validation.constraints.Min(value = 1, message = "Repayment must be at least 1 month")
            @jakarta.validation.constraints.Max(value = 60, message = "Repayment cannot exceed 60 months") Integer repaymentMonths) {}

    /**
     * HR / finance raise a salary advance for another employee. It is the same
     * request the employee could make themselves: routed to the employee's
     * approver, then paid out and recovered from their salary as usual. The
     * raiser is recorded and the employee is notified. Holders of
     * {@code hrms.advance.request.others} may raise for any active employee
     * of the workspace, but never for themselves (that is their own request).
     */
    @Operation(summary = "Raise a salary advance request on an employee's behalf (HR / finance)")
    @PostMapping("/requests/on-behalf")
    @PreAuthorize("hasAuthority('hrms.advance.request.others')")
    public ResponseEntity<AdvanceResponse> requestOnBehalf(
            @Valid @RequestBody AdvanceOnBehalfRequest body,
            @AuthenticationPrincipal Jwt jwt) {
        UUID caller = extractEmployeeId(jwt);
        if (body.employeeId().equals(caller)) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "To ask for an advance for yourself, use your own advance request.", "ADVANCE_ON_BEHALF_SELF");
        }
        Employee employee = employeeRepository.findById(body.employeeId())
                .orElseThrow(() -> new com.hrms.core.exception.ResourceNotFoundException("Employee", body.employeeId()));
        if (employee.getEmploymentStatus() != null && SEPARATED.contains(employee.getEmploymentStatus().name())) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "This employee has left the company, so an advance can't be raised for them.", "ADVANCE_EMPLOYEE_SEPARATED");
        }
        AdvanceRequestCreateRequest request = new AdvanceRequestCreateRequest(
                body.amount(), body.reason() == null || body.reason().isBlank() ? null : body.reason().trim(), body.repaymentMonths());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(advanceService.requestAdvanceOnBehalf(
                        employee.getId(), employee.getCompanyId(), request, resolveApprover(employee), caller)));
    }

    private static final java.util.Set<String> SEPARATED = java.util.Set.of("EXITED", "TERMINATED", "RESIGNED", "RETIRED");

    /**
     * The employee's advance approver: their reporting manager, else the
     * workspace's terminal approver (HR / super admin), redirected through any
     * active delegation.
     *
     * <p>B3 FIX (audit 2026-08-15): reject an advance request whose approver
     * would be null (no manager configured) OR self (manager==requester, the
     * direct-manager pointer is stale). Fall back to a terminal approver
     * (HR/SUPER_ADMIN) so the request routes to a real inbox instead of a
     * dead-lettered null. If even that resolves to self, reject cleanly,
     * never let an employee self-approve.
     */
    private UUID resolveApprover(Employee employee) {
        ApproverChoice choice = chooseApprover(employee);
        if (choice == null) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "No eligible approver found for this workspace. "
                    + "Ask your admin to configure a reporting manager or HR before raising an advance.",
                    "ADVANCE_NO_APPROVER");
        }
        return choice.approverId();
    }

    /**
     * Who an advance for this employee goes to, and why. The one chain both the
     * request and its preview use (BW-62), so what the preview names is who
     * gets the request. {@code source}: MANAGER (the reporting manager),
     * TERMINAL (no usable manager: the workspace's HR manager, else an admin),
     * DELEGATE (the approver's active delegate; {@code delegateFor} is who they
     * stand in for). Null when nobody but the employee could approve.
     */
    record ApproverChoice(UUID approverId, String source, UUID delegateFor) {}

    private ApproverChoice chooseApprover(Employee employee) {
        UUID employeeId = employee.getId();
        UUID approverId = employee.getManagerId();
        String source = "MANAGER";
        if (approverId == null || approverId.equals(employeeId)) {
            UUID fallback = approverFallback.resolveTerminalApprover(
                    com.hrms.core.tenant.TenantContext.getTenantId()).orElse(null);
            if (fallback == null || fallback.equals(employeeId)) return null;
            approverId = fallback;
            source = "TERMINAL";
        }
        // Redirect through any active delegation the approver has set up.
        UUID finalId = approverFallback.redirectIfDelegated(
                approverId, java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")));
        if (finalId != null && !finalId.equals(approverId)) return new ApproverChoice(finalId, "DELEGATE", approverId);
        return new ApproverChoice(finalId, source, null);
    }

    // ─── Redesign reads (BW-62) ──────────────────────────────────────────────

    /** Who approves the caller's advance request: HR = the HR manager fallback, ADMIN = the admin fallback. */
    public record AdvanceApprover(UUID employeeId, String name, String source, String delegateForName) {}

    /** {@code approver} is null when nobody can approve (a request would be refused with ADVANCE_NO_APPROVER). */
    public record ApproverPreview(AdvanceApprover approver) {}

    /**
     * What a request for {@code amount} over {@code months} would look like,
     * under today's rules: the monthly deduction rounded to paise as the
     * request stores it (the last installment takes the remainder), recovery
     * starting the month after payout (assumed this month; finance may choose
     * a later first month when recording the payment), and who approves it.
     * {@code netMonthly} / {@code takeHomeAfterDeduction} come from the
     * caller's current salary structure, only with payroll.structure.read.self
     * and a structure on file (null otherwise). There is no advance limit.
     */
    public record AdvancePreview(java.math.BigDecimal amount, int months, java.math.BigDecimal monthlyDeduction,
                                 java.math.BigDecimal lastInstallment, String assumedPayoutMonth,
                                 String firstDeductionMonth, String lastDeductionMonth, AdvanceApprover approver,
                                 java.math.BigDecimal netMonthly, java.math.BigDecimal takeHomeAfterDeduction) {}

    /** The finance side of Record payment: both optional (BW-62). */
    public record DisburseRequest(
            @jakarta.validation.constraints.Size(max = 100, message = "Keep the payment reference under 100 characters")
            String paymentReference,
            /** "2026-11": the first salary month to recover from; the month after payout when left out. */
            String firstDeductionMonth) {}

    /** How far ahead finance may start the recovery: up to eleven months after the default first month. */
    static final int FIRST_DEDUCTION_MAX_MONTHS_AHEAD = 11;

    @Operation(summary = "Totals of the advances in my scope: requested, approved not paid, being recovered, repaid")
    @GetMapping("/summary")
    @PreAuthorize("hasAuthority('hrms.advance.read')")
    public ResponseEntity<AdvanceReadService.AdvancesSummary> summary(@AuthenticationPrincipal Jwt jwt) {
        UUID tenantId = com.hrms.core.tenant.TenantContext.getTenantId();
        UUID caller = extractEmployeeId(jwt);
        PayFinancialYear year = PayFinancialYear.of(jdbc, tenantId, caller,
                java.time.LocalDate.now(PayFinancialYear.IST));
        // Same scope as the list: everything with disburse, else what is routed to you.
        return ResponseEntity.ok(reads.summary(tenantId, seesAllAdvances(jwt) ? null : scopeOf(caller), year));
    }

    @Operation(summary = "Totals of my own advances")
    @GetMapping("/my/summary")
    @PreAuthorize("hasAuthority('hrms.advance.request.self')")
    public ResponseEntity<AdvanceReadService.MyAdvancesSummary> mySummary(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(reads.mySummary(com.hrms.core.tenant.TenantContext.getTenantId(), extractEmployeeId(jwt)));
    }

    @Operation(summary = "Who would approve my advance request")
    @GetMapping("/my/approver")
    @PreAuthorize("hasAuthority('hrms.advance.request.self')")
    public ResponseEntity<ApproverPreview> myApprover(@AuthenticationPrincipal Jwt jwt) {
        UUID me = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(me)
                .orElseThrow(() -> new com.hrms.core.exception.ResourceNotFoundException("Employee", me));
        return ResponseEntity.ok(new ApproverPreview(describe(chooseApprover(employee))));
    }

    @Operation(summary = "Preview an advance request: monthly deduction, recovery months and approver")
    @GetMapping("/my/preview")
    @PreAuthorize("hasAuthority('hrms.advance.request.self')")
    public ResponseEntity<AdvancePreview> myPreview(@RequestParam java.math.BigDecimal amount,
                                                    @RequestParam int months,
                                                    @AuthenticationPrincipal Jwt jwt) {
        // The same rules as the request itself (AdvanceRequestCreateRequest + AdvanceService).
        if (amount.compareTo(new java.math.BigDecimal("0.01")) < 0) {
            throw new com.hrms.core.exception.BusinessRuleException("Advance amount must be greater than zero", "ADVANCE_INVALID_AMOUNT");
        }
        if (months < 1 || months > 60) {
            throw new com.hrms.core.exception.BusinessRuleException("Repay over 1 to 60 whole months.", "ADVANCE_INVALID_TERM");
        }
        UUID me = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(me)
                .orElseThrow(() -> new com.hrms.core.exception.ResourceNotFoundException("Employee", me));
        java.math.BigDecimal[] plan = plan(amount, months);
        java.time.YearMonth payout = java.time.YearMonth.now(PayFinancialYear.IST);
        java.time.YearMonth first = payout.plusMonths(1);
        java.math.BigDecimal net = callerHasPermission(jwt, "payroll.structure.read.self") ? netMonthly(me) : null;
        return ResponseEntity.ok(new AdvancePreview(amount, months, plan[0], plan[1], payout.toString(), first.toString(),
                first.plusMonths(months - 1L).toString(), describe(chooseApprover(employee)),
                net, net == null ? null : net.subtract(plan[0])));
    }

    /**
     * [monthly deduction, last installment] exactly as the request and its
     * recovery schedule compute them (AdvanceService, AdvanceRecoveryService.initSchedule).
     */
    static java.math.BigDecimal[] plan(java.math.BigDecimal amount, int months) {
        java.math.BigDecimal monthly = amount.divide(java.math.BigDecimal.valueOf(months), 2, java.math.RoundingMode.HALF_UP);
        java.math.BigDecimal remaining = amount;
        java.math.BigDecimal last = java.math.BigDecimal.ZERO;
        for (int i = 1; i <= months; i++) {
            last = AdvanceRecoveryService.installmentAmount(remaining, monthly, i == months);
            remaining = remaining.subtract(last);
        }
        return new java.math.BigDecimal[]{monthly, last};
    }

    /** The caller's full-month take-home from their current structure; null when there is none or it can't be read. */
    private java.math.BigDecimal netMonthly(UUID employeeId) {
        try {
            var structure = payrollService.getCurrentStructure(com.hrms.core.tenant.TenantContext.getTenantId(), employeeId);
            return structure == null ? null : structure.netMonthly();
        } catch (RuntimeException e) {
            // An optional figure: leave it out rather than fail the preview.
            org.slf4j.LoggerFactory.getLogger(AdvanceController.class)
                    .warn("Advance preview: take-home not available for {}: {}", employeeId, e.getMessage());
            return null;
        }
    }

    private AdvanceApprover describe(ApproverChoice choice) {
        if (choice == null || choice.approverId() == null) return null;
        Employee approver = employeeRepository.findById(choice.approverId()).orElse(null);
        String source = choice.source();
        if ("TERMINAL".equals(source)) {
            source = reads.isHrManager(com.hrms.core.tenant.TenantContext.getTenantId(), choice.approverId()) ? "HR" : "ADMIN";
        }
        Employee delegateFor = choice.delegateFor() == null ? null
                : employeeRepository.findById(choice.delegateFor()).orElse(null);
        return new AdvanceApprover(choice.approverId(), fullName(approver), source, fullName(delegateFor));
    }

    /**
     * The first month to recover from: the month after payout unless finance
     * chose a later one ("2026-11"), at most {@value #FIRST_DEDUCTION_MAX_MONTHS_AHEAD}
     * months after that. Never earlier, so a recovery can't fall into a
     * payroll month that may already have run.
     */
    static java.time.YearMonth firstDeductionMonth(String requested, java.time.YearMonth payoutMonth) {
        java.time.YearMonth earliest = payoutMonth.plusMonths(1);
        if (requested == null || requested.isBlank()) return earliest;
        java.time.YearMonth chosen;
        try {
            chosen = java.time.YearMonth.parse(requested.trim());
        } catch (java.time.format.DateTimeParseException e) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "Choose the first deduction month as a month, like " + earliest + ".", "ADVANCE_INVALID_FIRST_MONTH");
        }
        java.time.YearMonth latest = earliest.plusMonths(FIRST_DEDUCTION_MAX_MONTHS_AHEAD);
        if (chosen.isBefore(earliest) || chosen.isAfter(latest)) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "The first deduction can be from " + earliest + " to " + latest + ".", "ADVANCE_INVALID_FIRST_MONTH");
        }
        return chosen;
    }

    private static UUID scopeOf(UUID caller) {
        return caller == null ? NO_APPROVER : caller;
    }

    @Operation(summary = "Get my salary advance requests")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('hrms.advance.request.self')")
    public ResponseEntity<PageResponse<AdvanceResponse>> myRequests(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        // Enriched so a request HR raised for the employee says who raised it.
        return ResponseEntity.ok(enrichPage(advanceService.getMyRequests(extractEmployeeId(jwt), pageable)));
    }

    @Operation(summary = "Get a single salary advance request")
    @GetMapping("/requests/{id}")
    @PreAuthorize("hasAnyAuthority('hrms.advance.read','hrms.advance.request.self')")
    public ResponseEntity<AdvanceResponse> getRequest(@PathVariable UUID id,
                                                      @AuthenticationPrincipal Jwt jwt) {
        AdvanceResponse adv = enrichOne(advanceService.getRequest(id));
        // Object-level authz (prevent intra-tenant IDOR): self-permission callers may
        // read ONLY their own request; the admin read permission may read any.
        UUID employeeId = extractEmployeeId(jwt);
        if (!seesAllAdvances(jwt)
                && !Objects.equals(adv.employeeId(), employeeId)
                && !(callerHasPermission(jwt, "hrms.advance.read") && Objects.equals(adv.approverId(), employeeId))) {
            throw new org.springframework.security.access.AccessDeniedException("Not permitted to view this advance request");
        }
        return ResponseEntity.ok(adv);
    }

    private boolean callerHasPermission(Jwt jwt, String permission) {
        java.util.List<String> perms = jwt.getClaimAsStringList("permissions");
        return perms != null && perms.contains(permission);
    }

    @Operation(summary = "List salary advances across all statuses, scoped to the caller")
    @GetMapping("/requests")
    @PreAuthorize("hasAuthority('hrms.advance.read')")
    public ResponseEntity<PageResponse<AdvanceResponse>> listRequests(
            @RequestParam(required = false) AdvanceStatus status,
            @RequestParam(required = false) AdvanceReadService.Phase phase,
            @RequestParam(required = false) UUID departmentId,
            @PageableDefault(size = 20) Pageable pageable,
            @AuthenticationPrincipal Jwt jwt) {
        if (phase != null || departmentId != null) {
            // BW-62: Recovering / Repaid and a department, in the same scope as below.
            AdvanceReadService.IdPage ids = reads.filteredIds(com.hrms.core.tenant.TenantContext.getTenantId(),
                    seesAllAdvances(jwt) ? null : scopeOf(extractEmployeeId(jwt)),
                    status == null ? null : List.of(status.name()), phase, departmentId,
                    pageable.getPageNumber(), pageable.getPageSize());
            int size = Math.max(1, pageable.getPageSize());
            int totalPages = (int) ((ids.total() + size - 1) / size);
            return ResponseEntity.ok(enrichPage(new PageResponse<>(advanceService.getByIdsInOrder(ids.ids()),
                    pageable.getPageNumber(), pageable.getPageSize(), ids.total(), totalPages,
                    pageable.getPageNumber() + 1 >= totalPages)));
        }
        var statuses = status == null ? List.of(AdvanceStatus.values()) : List.of(status);
        return ResponseEntity.ok(enrichPage(seesAllAdvances(jwt)
                ? advanceService.getByStatuses(statuses, pageable)
                : advanceService.getPendingForApprover(extractEmployeeId(jwt), statuses, pageable)));
    }

    // ─── Approvals (manager / HR) ────────────────────────────────────────────

    @Operation(summary = "List salary advance requests awaiting approval OR disbursement")
    @GetMapping("/requests/approvals")
    // 2026-09-08 audit: two fixes in one.
    //  1. Was approve-only. FINANCE_LEAD is seeded hrms.advance.disburse WITHOUT
    //     approve (V068), so the Approvals tab 403'd for exactly the role that
    //     pays advances out, and the UI rendered "Nothing awaiting approval".
    //  2. Was hard-coded to REQUESTED. The Disburse button in Advance.tsx only
    //     renders for status==='APPROVED', so it was unreachable — advances
    //     could be approved but never disbursed, and since disburse seeds the
    //     salary-recovery schedule, recovery never started either.
    //  3. 2026-09-09: was tenant-wide for anyone holding hrms.advance.approve,
    //     a permission DEPT_MANAGER holds — so a department manager could read
    //     every salary advance in the company, including other departments' and
    //     executives'. Same class of hole the Expense approvals queue had.
    //
    //     hrms.advance.disburse is the tenant-wide marker: it is the finance/HR
    //     tier (FINANCE_LEAD, HR_MANAGER, OWNER, SUPER_ADMIN) and they must see
    //     everything to pay advances out. DEPT_MANAGER holds approve WITHOUT
    //     disburse, so they get only advances routed to them. That is exactly
    //     the client's standing rule: dept manager cannot see, HR can.
    @PreAuthorize("hasAnyAuthority('hrms.advance.approve','hrms.advance.disburse')")
    public ResponseEntity<PageResponse<AdvanceResponse>> pendingApprovals(
            @PageableDefault(size = 20) Pageable pageable,
            @AuthenticationPrincipal Jwt jwt) {
        var statuses = java.util.List.of(AdvanceStatus.REQUESTED, AdvanceStatus.APPROVED);
        if (seesAllAdvances(jwt)) {
            return ResponseEntity.ok(enrichPage(advanceService.getByStatuses(statuses, pageable)));
        }
        UUID approver = extractEmployeeId(jwt);
        if (approver == null) {
            // No employee identity to scope by — show nothing rather than
            // everything. Failing open here would reinstate the leak.
            return ResponseEntity.ok(enrichPage(
                    advanceService.getPendingForApprover(NO_APPROVER, statuses, pageable)));
        }
        return ResponseEntity.ok(enrichPage(
                advanceService.getPendingForApprover(approver, statuses, pageable)));
    }

    /** Sentinel that matches no row, so an unidentifiable caller sees an empty queue. */
    private static final UUID NO_APPROVER = new UUID(0L, 0L);

    /**
     * Finance/HR tier — the roles that must see every advance in order to pay
     * them out. Deliberately the SAME predicate the decide() guard uses, so
     * what a caller can act on always equals what their queue shows them;
     * letting the two drift produces either approvers who see requests they
     * cannot action, or worse, ones they can action but never see.
     */
    private boolean seesAllAdvances(Jwt jwt) {
        return callerHasPermission(jwt, "hrms.advance.disburse");
    }

    @Operation(summary = "Approve or reject a salary advance request")
    @PostMapping("/requests/{id}/decision")
    @PreAuthorize("@perm.check('hrms.advance.approve')")
    public ResponseEntity<AdvanceResponse> decide(
            @PathVariable UUID id,
            @Valid @RequestBody AdvanceDecisionRequest decision,
            @AuthenticationPrincipal Jwt jwt) {
        UUID approver = extractEmployeeId(jwt);
        // B3 FIX (audit 2026-08-15): self-approval guard. An employee whose
        // reporting_manager_id is themselves (or who forges the approver on the
        // way in) could approve their own advance and skip to disbursement.
        AdvanceResponse existing = advanceService.getRequest(id);
        if (approver != null && approver.equals(existing.employeeId())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You cannot approve your own advance request.");
        }
        // 2026-09-09: object-level guard. Until now the ONLY check here was the
        // self-approval one above, so holding hrms.advance.approve was enough to
        // decide ANY advance id in the tenant — a department manager could
        // approve an executive's advance by guessing or scraping the id.
        // Scoping the queue without scoping the write only hides the target; it
        // does not protect it. Mirrors seesAllAdvances() exactly so what you can
        // act on equals what your queue shows you.
        if (!seesAllAdvances(jwt) && !java.util.Objects.equals(existing.approverId(), approver)) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "This advance request is not routed to you for approval.");
        }
        return ResponseEntity.ok(enrichOne(advanceService.decide(id, approver, decision)));
    }

    // ─── Disbursement (finance) ──────────────────────────────────────────────

    @Operation(summary = "Mark an approved advance as disbursed")
    @PostMapping("/requests/{id}/disburse")
    @PreAuthorize("@perm.check('hrms.advance.disburse')")
    @org.springframework.transaction.annotation.Transactional
    public ResponseEntity<AdvanceResponse> disburse(@PathVariable UUID id,
                                                    @Valid @RequestBody(required = false) DisburseRequest body,
                                                    @AuthenticationPrincipal Jwt jwt) {
        // BW-62: an optional bank reference and first deduction month, checked
        // before anything changes. With no body it is today's payout exactly.
        java.time.YearMonth startMonth = firstDeductionMonth(body == null ? null : body.firstDeductionMonth(),
                java.time.YearMonth.now(java.time.ZoneId.of("Asia/Kolkata")));
        String paymentReference = body == null || body.paymentReference() == null || body.paymentReference().isBlank()
                ? null : body.paymentReference().trim();
        // B3 FIX (audit 2026-08-15): disburser must not equal the requester.
        AdvanceResponse existing = advanceService.getRequest(id);
        UUID caller = jwt == null ? null : extractEmployeeId(jwt);
        if (caller != null && caller.equals(existing.employeeId())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You cannot disburse your own advance.");
        }
        AdvanceResponse result = advanceService.disburse(id);
        // B3 CRIT FIX (audit 2026-08-15): AdvanceService.disburse never seeded
        // the recovery schedule, so every disbursed advance stayed outstanding
        // forever — payroll never had a PENDING installment to consume. Seed
        // it here starting the month AFTER disbursement (first payroll cycle
        // that runs post-disbursement will pick up installment #1).
        advanceRecoveryService.initSchedule(
                com.hrms.core.tenant.TenantContext.getTenantId(),
                id, startMonth.getMonthValue(), startMonth.getYear(), paymentReference);
        return ResponseEntity.ok(enrichOne(result));
    }

    // ─── Requester identity enrichment ───────────────────────────────────────
    // The advance module has no dependency on hrms-employee, so the requester's
    // name / code are resolved here (the API layer) and folded into the response
    // so approver/finance cards can show WHOSE advance it is.

    private PageResponse<AdvanceResponse> enrichPage(PageResponse<AdvanceResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .flatMap(r -> java.util.stream.Stream.of(r.employeeId(), r.raisedById()))
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        Map<UUID, String> departments = departmentNames(page.content().stream()
                .map(r -> employeeMap.get(r.employeeId())).filter(Objects::nonNull).toList());
        List<AdvanceResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId()),
                        r.raisedById() == null ? null : employeeMap.get(r.raisedById()), departments))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private AdvanceResponse enrichOne(AdvanceResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        Employee raisedBy = r.raisedById() == null
                ? null
                : employeeRepository.findById(r.raisedById()).orElse(null);
        return enrich(r, employee, raisedBy, employee == null ? Map.of() : departmentNames(List.of(employee)));
    }

    private Map<UUID, String> departmentNames(java.util.Collection<Employee> employees) {
        List<UUID> ids = employees.stream().map(Employee::getDepartmentId).filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        Map<UUID, String> names = new java.util.HashMap<>();
        departmentRepository.findAllById(ids).forEach(d -> names.put(d.getId(), d.getName()));
        return names;
    }

    private static String fullName(Employee e) {
        return e == null ? null
                : (e.getFirstName() + " " + (e.getLastName() == null ? "" : e.getLastName())).trim();
    }

    private AdvanceResponse enrich(AdvanceResponse r, Employee employee, Employee raisedBy, Map<UUID, String> departments) {
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        UUID departmentId = employee != null ? employee.getDepartmentId() : null;
        return new AdvanceResponse(
                r.id(), r.employeeId(), fullName(employee), employeeCode, r.companyId(),
                r.amount(), r.reason(), r.repaymentMonths(), r.monthlyDeduction(),
                r.status(), r.approverId(), r.approvedAt(), r.approverComment(),
                r.disbursedAt(), r.outstandingAmount(), r.createdAt(),
                r.raisedById(), fullName(raisedBy),
                departmentId, departmentId == null ? null : departments.get(departmentId));
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
