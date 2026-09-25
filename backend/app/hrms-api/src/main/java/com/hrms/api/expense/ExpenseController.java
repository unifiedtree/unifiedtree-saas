package com.hrms.api.expense;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.expense.dto.ExpenseClaimRequest;
import com.hrms.expense.dto.ExpenseClaimResponse;
import com.hrms.expense.dto.ExpenseDecisionRequest;
import com.hrms.expense.dto.ExpenseDashboardStatsResponse;
import com.hrms.expense.dto.ExpenseItemResponse;
import com.hrms.expense.dto.ExpensePolicyRequest;
import com.hrms.expense.dto.ExpensePolicyResponse;
import com.hrms.expense.service.ExpenseService;
import com.hrms.expense.service.ExpensePolicyService;
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
 * Expense reimbursement: employee self-service claims, manager/HR approval,
 * finance reimbursement, and per-company policy administration.
 */
@RestController
@RequestMapping("/v1/expense")
@Tag(name = "Expense", description = "Expense claims, approvals, reimbursement, and policies")
@SecurityRequirement(name = "bearerAuth")
public class ExpenseController {

    private final ExpenseService expenseService;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.hrms.api.leave.ApproverFallbackResolver delegationResolver;
    private final ExpensePolicyService policyService;
    private final EmployeeRepository employeeRepository;
    private final ExpenseReceipts receipts;
    private final com.hrms.api.employee.EmployeeRecordAccess recordAccess;

    public ExpenseController(ExpenseService expenseService,
                             ExpensePolicyService policyService,
                             EmployeeRepository employeeRepository,
                             ExpenseReceipts receipts,
                             com.hrms.api.employee.EmployeeRecordAccess recordAccess) {
        this.expenseService = expenseService;
        this.policyService = policyService;
        this.employeeRepository = employeeRepository;
        this.receipts = receipts;
        this.recordAccess = recordAccess;
    }

    /** V143.13: sees anyone's claims on the employee record (HR / admin / finance). */
    static final String EMPLOYEE_READ = "hrms.expense.employee.read";


    @Operation(summary = "Get expense dashboard statistics")
    @GetMapping("/dashboard-stats")
    @PreAuthorize("hasAnyAuthority('hrms.expense.claim.read','hrms.expense.claim.approve','hrms.expense.reimbursement')")
    public ResponseEntity<ExpenseDashboardStatsResponse> dashboardStats(@AuthenticationPrincipal Jwt jwt) {
        // Same scope as the approvals queue below: finance/admin (reimbursement
        // holders) see company-wide totals; anyone else only the claims routed
        // to them. Company-wide totals were reaching every department manager.
        return ResponseEntity.ok(callerHasPermission(jwt, "hrms.expense.reimbursement")
                ? expenseService.dashboardStats()
                : expenseService.dashboardStatsForApprover(extractEmployeeId(jwt)));
    }

    // ─── Employee self-service ───────────────────────────────────────────────

    @Operation(summary = "Submit an expense claim with line items")
    @PostMapping("/claims")
    @PreAuthorize("hasAuthority('hrms.expense.claim.self')")
    public ResponseEntity<ExpenseClaimResponse> submit(
            @Valid @RequestBody ExpenseClaimRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        UUID companyId = request.companyId() != null ? request.companyId() : employee.getCompanyId();
        UUID approverId = employee.getManagerId();
        // Redirect through any active delegation the approver has set up.
        if (approverId != null && delegationResolver != null) {
            approverId = delegationResolver.redirectIfDelegated(
                    approverId, java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")));
        }
        ExpenseClaimRequest checked = withOwnReceiptsOnly(request, employeeId);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(expenseService.submitClaim(employeeId, companyId, checked, approverId)));
    }

    /**
     * A line's receiptUrl must be a receipt the claimant uploaded through
     * POST /v1/expense/receipts (this workspace, this employee). Anything else
     * (someone else's key, another workspace's, a pasted link) is refused, so a
     * claim can never be used to read a file its claimant didn't upload.
     */
    private ExpenseClaimRequest withOwnReceiptsOnly(ExpenseClaimRequest request, UUID employeeId) {
        UUID tenant = com.hrms.core.tenant.TenantContext.getTenantId();
        List<com.hrms.expense.dto.ExpenseItemRequest> items = new java.util.ArrayList<>();
        int line = 0;
        for (com.hrms.expense.dto.ExpenseItemRequest item : request.items()) {
            line++;
            String url = item.receiptUrl() == null || item.receiptUrl().isBlank() ? null : item.receiptUrl().trim();
            if (url != null && !ExpenseReceipts.isOwnedBy(url, tenant, employeeId)) {
                throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "The receipt on line " + line + " isn't one you uploaded. Attach the file again.");
            }
            items.add(new com.hrms.expense.dto.ExpenseItemRequest(item.category(), item.description(), item.amount(),
                    item.expenseDate(), url, item.merchantName()));
        }
        return new ExpenseClaimRequest(request.companyId(), request.title(), request.currency(), request.notes(), items);
    }

    // ─── Receipts (V143.13) ──────────────────────────────────────────────────

    @Operation(summary = "Upload a receipt for one of my expense lines (PDF, PNG or JPEG, up to 10 MB)")
    @PostMapping(value = "/receipts", consumes = org.springframework.http.MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('hrms.expense.claim.self')")
    public ResponseEntity<ExpenseReceipts.Stored> uploadReceipt(
            @RequestPart("file") org.springframework.web.multipart.MultipartFile file,
            @AuthenticationPrincipal Jwt jwt) throws java.io.IOException {
        UUID employeeId = requireEmployeeId(jwt);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(receipts.store(com.hrms.core.tenant.TenantContext.getTenantId(), employeeId, file));
    }

    @Operation(summary = "Attach or replace the receipt on a line of my claim while it waits for a decision")
    @PostMapping(value = "/claims/{id}/items/{itemId}/receipt", consumes = org.springframework.http.MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('hrms.expense.claim.self')")
    public ResponseEntity<ExpenseClaimResponse> attachReceipt(
            @PathVariable UUID id, @PathVariable UUID itemId,
            @RequestPart("file") org.springframework.web.multipart.MultipartFile file,
            @AuthenticationPrincipal Jwt jwt) throws java.io.IOException {
        UUID employeeId = requireEmployeeId(jwt);
        ExpenseClaimResponse claim = expenseService.getClaim(id);
        if (!Objects.equals(claim.employeeId(), employeeId)) {
            throw new org.springframework.security.access.AccessDeniedException("You can only add receipts to your own claims.");
        }
        UUID tenant = com.hrms.core.tenant.TenantContext.getTenantId();
        ExpenseReceipts.Stored stored = receipts.store(tenant, employeeId, file);
        String previous;
        try {
            previous = expenseService.attachReceipt(id, itemId, stored.receiptUrl());
        } catch (RuntimeException failure) {
            receipts.deleteQuietly(stored.receiptUrl(), tenant);
            throw failure;
        }
        if (previous != null && !previous.equals(stored.receiptUrl())) receipts.deleteQuietly(previous, tenant);
        return ResponseEntity.ok(enrichOne(expenseService.getClaim(id)));
    }

    // ─── Another person's claims (employee workspace, V143.13) ───────────────

    @Operation(summary = "An employee's expense claims, newest first (HR / admin / finance: anyone; managers: their team; else self)")
    @GetMapping("/employees/{employeeId}/claims")
    @PreAuthorize("hasAnyAuthority('hrms.expense.employee.read','hrms.expense.claim.approve','hrms.expense.claim.self')")
    public ResponseEntity<PageResponse<ExpenseClaimResponse>> employeeClaims(
            @PathVariable UUID employeeId,
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth,
            @PageableDefault(size = 20) Pageable pageable) {
        recordAccess.assertCanView(employeeId, jwt, auth, EMPLOYEE_READ, "hrms.expense.claim.approve");
        return ResponseEntity.ok(enrichPage(expenseService.getEmployeeClaims(employeeId, pageable)));
    }

    @Operation(summary = "Get my expense claims")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('hrms.expense.claim.self')")
    public ResponseEntity<PageResponse<ExpenseClaimResponse>> myClaims(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(expenseService.getMyClaims(extractEmployeeId(jwt), pageable));
    }

    @Operation(summary = "Get a single expense claim with its line items")
    @GetMapping("/claims/{id}")
    @PreAuthorize("hasAnyAuthority('hrms.expense.claim.read','hrms.expense.claim.self')")
    public ResponseEntity<ExpenseClaimResponse> getClaim(@PathVariable UUID id,
                                                         @AuthenticationPrincipal Jwt jwt) {
        ExpenseClaimResponse raw = expenseService.getClaim(id);
        // Object-level authz (prevent intra-tenant IDOR). The claim now carries
        // receipt files, so claim.read alone no longer opens every claim in the
        // tenant (V143.13): the claimant, anyone-readers (HR / admin / finance),
        // the claim's approver, or a manager whose team the claimant is in.
        UUID me = extractEmployeeId(jwt);
        boolean allowed = Objects.equals(raw.employeeId(), me)
                || callerHasPermission(jwt, EMPLOYEE_READ)
                || callerHasPermission(jwt, "hrms.expense.reimbursement")
                || (Objects.equals(raw.approverId(), me)
                    && (callerHasPermission(jwt, "hrms.expense.claim.read") || callerHasPermission(jwt, "hrms.expense.claim.approve")));
        if (!allowed && callerHasPermission(jwt, "hrms.expense.claim.read")) {
            recordAccess.assertCanView(raw.employeeId(), jwt,
                    org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication(),
                    EMPLOYEE_READ, "hrms.expense.claim.read");
            allowed = true;
        }
        if (!allowed) {
            throw new org.springframework.security.access.AccessDeniedException("Not permitted to view this claim");
        }
        return ResponseEntity.ok(enrichOne(raw));
    }

    private boolean callerHasPermission(Jwt jwt, String permission) {
        java.util.List<String> perms = jwt.getClaimAsStringList("permissions");
        return perms != null && perms.contains(permission);
    }

    // ─── Approvals (manager / HR) ────────────────────────────────────────────

    @Operation(summary = "List expense claims awaiting approval (SUBMITTED) or reimbursement (APPROVED)")
    @GetMapping("/claims/approvals")
    // 2026-09-08 audit: three fixes in one.
    //  1. SCOPE. Was tenant-wide getByStatus(SUBMITTED) for anyone holding
    //     claim.approve — a DEPT_MANAGER could see and approve every claim in
    //     the company, other departments' and executives' included.
    //     ExpenseService.getPendingApprovals(approverId, ...) existed for exactly
    //     this and was never called. Now: finance/admin (reimbursement holders)
    //     see the tenant; plain approvers see only claims routed to them.
    //  2. STATUS. Was SUBMITTED-only, so the moment a claim was approved it
    //     vanished from every screen and nobody could reach the reimburse
    //     endpoint — every claim stalled at APPROVED. Now returns SUBMITTED +
    //     APPROVED; the UI shows Approve/Reject or Mark-Reimbursed per row.
    //  3. AUTH. Reimbursement-only roles could not load the tab at all.
    @PreAuthorize("hasAnyAuthority('hrms.expense.claim.approve','hrms.expense.reimbursement')")
    public ResponseEntity<PageResponse<ExpenseClaimResponse>> pendingApprovals(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        java.util.List<String> perms = jwt.getClaimAsStringList("permissions");
        boolean financeOrAdmin = perms != null && perms.contains("hrms.expense.reimbursement");
        java.util.List<com.hrms.expense.enums.ExpenseStatus> open = java.util.List.of(
                com.hrms.expense.enums.ExpenseStatus.SUBMITTED,
                com.hrms.expense.enums.ExpenseStatus.APPROVED);
        PageResponse<ExpenseClaimResponse> page = financeOrAdmin
                ? expenseService.getByStatuses(open, pageable)
                : expenseService.getPendingForApprover(extractEmployeeId(jwt), open, pageable);
        return ResponseEntity.ok(enrichPage(page));
    }

    @Operation(summary = "Approve or reject an expense claim")
    @PostMapping("/claims/{id}/decision")
    @PreAuthorize("@perm.check('hrms.expense.claim.approve')")
    public ResponseEntity<ExpenseClaimResponse> decide(
            @PathVariable UUID id,
            @Valid @RequestBody ExpenseDecisionRequest decision,
            @AuthenticationPrincipal Jwt jwt) {
        UUID approver = extractEmployeeId(jwt);
        // 2026-09-09: object-level authz on the WRITE path (intra-tenant IDOR).
        // The 2026-09-08 audit scoped the approvals QUEUE — a DEPT_MANAGER now
        // only lists claims routed to them — but left this endpoint wide open:
        // holding claim.approve was enough to POST a decision on ANY claim id
        // in the tenant, including other departments' and executives'. Scoping
        // the read without scoping the write just hides the target, it does not
        // protect it.
        //
        // The rule deliberately mirrors pendingApprovals exactly, so what you
        // can act on equals what your queue shows you: holders of
        // hrms.expense.reimbursement (OWNER / SUPER_ADMIN — FINANCE_LEAD is not
        // seeded claim.approve, so @perm.check already stops them) get the same
        // tenant-wide reach they get in the list; everyone else must be the
        // claim's assigned approver. Claims with a null approver_id (submitter
        // had no manager) fall to the tenant-wide holders, which is also the
        // only place they appear in the queue — so nothing becomes unreachable.
        ExpenseClaimResponse existing = expenseService.getClaim(id);
        if (!callerHasPermission(jwt, "hrms.expense.reimbursement")
                && !Objects.equals(existing.approverId(), approver)) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "This expense claim is not routed to you for approval.");
        }
        return ResponseEntity.ok(enrichOne(expenseService.decide(id, approver, decision)));
    }

    // ─── Reimbursement (finance) ─────────────────────────────────────────────

    @Operation(summary = "Mark an approved claim as reimbursed")
    @PostMapping("/claims/{id}/reimburse")
    @PreAuthorize("@perm.check('hrms.expense.reimbursement')")
    public ResponseEntity<ExpenseClaimResponse> reimburse(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(expenseService.reimburse(id)));
    }

    // ─── Policy administration ───────────────────────────────────────────────

    @Operation(summary = "List expense policies for a company")
    @GetMapping("/policies")
    @PreAuthorize("hasAuthority('hrms.expense.policy.read')")
    public ResponseEntity<List<ExpensePolicyResponse>> listPolicies(@RequestParam UUID companyId) {
        return ResponseEntity.ok(policyService.listPolicies(companyId));
    }

    @Operation(summary = "Create an expense policy")
    @PostMapping("/policies")
    @PreAuthorize("hasAuthority('hrms.expense.policy.write')")
    public ResponseEntity<ExpensePolicyResponse> createPolicy(
            @Valid @RequestBody ExpensePolicyRequest request,
            @RequestParam(required = false) UUID companyId) {
        return ResponseEntity.status(HttpStatus.CREATED).body(policyService.createPolicy(companyId, request));
    }

    @Operation(summary = "Update an expense policy")
    @PutMapping("/policies/{id}")
    @PreAuthorize("hasAuthority('hrms.expense.policy.write')")
    public ResponseEntity<ExpensePolicyResponse> updatePolicy(
            @PathVariable UUID id,
            @Valid @RequestBody ExpensePolicyRequest request) {
        return ResponseEntity.ok(policyService.updatePolicy(id, request));
    }

    @Operation(summary = "Deactivate an expense policy")
    @DeleteMapping("/policies/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.expense.policy.write')")
    public void deactivatePolicy(@PathVariable UUID id) {
        policyService.deactivatePolicy(id);
    }

    // ─── Claimant identity enrichment ────────────────────────────────────────
    // The expense module has no dependency on hrms-employee, so the claimant's
    // name / code are resolved here (the API layer) and folded into the response
    // so approver/admin cards can show WHOSE claim it is.

    private PageResponse<ExpenseClaimResponse> enrichPage(PageResponse<ExpenseClaimResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .map(ExpenseClaimResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        List<ExpenseClaimResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId())))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private ExpenseClaimResponse enrichOne(ExpenseClaimResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        return enrich(r, employee);
    }

    private ExpenseClaimResponse enrich(ExpenseClaimResponse r, Employee employee) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + (employee.getLastName() == null ? "" : employee.getLastName())).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        // Receipts are stored as r2:// keys; hand out short-lived signed links only.
        UUID tenant = com.hrms.core.tenant.TenantContext.getTenantId();
        List<com.hrms.expense.dto.ExpenseItemResponse> items = r.items() == null ? null
                : r.items().stream().map(i -> new com.hrms.expense.dto.ExpenseItemResponse(
                        i.id(), i.category(), i.description(), i.amount(), i.expenseDate(),
                        receipts.signedUrl(i.receiptUrl(), tenant), i.merchantName(), i.hasReceipt())).toList();
        return new ExpenseClaimResponse(
                r.id(), r.employeeId(), employeeName, employeeCode, r.companyId(),
                r.title(), r.totalAmount(), r.currency(), r.status(), r.submittedAt(),
                r.approverId(), r.approvedAt(), r.approverComment(), r.reimbursedAt(),
                r.notes(), r.createdAt(), items, r.itemCount(), r.receiptCount());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

    /** Receipts belong to an employee record; a login without one can't upload them. */
    private static UUID requireEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        if (empId == null || empId.isBlank()) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Your login is not linked to an employee record.");
        }
        return UUID.fromString(empId);
    }
}
