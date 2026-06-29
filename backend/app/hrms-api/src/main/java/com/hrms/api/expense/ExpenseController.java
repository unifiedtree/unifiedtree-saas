package com.hrms.api.expense;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.expense.dto.ExpenseClaimRequest;
import com.hrms.expense.dto.ExpenseClaimResponse;
import com.hrms.expense.dto.ExpenseDecisionRequest;
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
    private final ExpensePolicyService policyService;
    private final EmployeeRepository employeeRepository;

    public ExpenseController(ExpenseService expenseService,
                             ExpensePolicyService policyService,
                             EmployeeRepository employeeRepository) {
        this.expenseService = expenseService;
        this.policyService = policyService;
        this.employeeRepository = employeeRepository;
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
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(expenseService.submitClaim(employeeId, companyId, request, approverId)));
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
    public ResponseEntity<ExpenseClaimResponse> getClaim(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(expenseService.getClaim(id)));
    }

    // ─── Approvals (manager / HR) ────────────────────────────────────────────

    @Operation(summary = "List expense claims awaiting approval")
    @GetMapping("/claims/approvals")
    @PreAuthorize("@perm.check('hrms.expense.claim.approve')")
    public ResponseEntity<PageResponse<ExpenseClaimResponse>> pendingApprovals(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(expenseService.getByStatus(
                com.hrms.expense.enums.ExpenseStatus.SUBMITTED, pageable)));
    }

    @Operation(summary = "Approve or reject an expense claim")
    @PostMapping("/claims/{id}/decision")
    @PreAuthorize("@perm.check('hrms.expense.claim.approve')")
    public ResponseEntity<ExpenseClaimResponse> decide(
            @PathVariable UUID id,
            @Valid @RequestBody ExpenseDecisionRequest decision,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichOne(expenseService.decide(id, extractEmployeeId(jwt), decision)));
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
                ? (employee.getFirstName() + " " + employee.getLastName()).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        return new ExpenseClaimResponse(
                r.id(), r.employeeId(), employeeName, employeeCode, r.companyId(),
                r.title(), r.totalAmount(), r.currency(), r.status(), r.submittedAt(),
                r.approverId(), r.approvedAt(), r.approverComment(), r.reimbursedAt(),
                r.notes(), r.createdAt(), r.items());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
