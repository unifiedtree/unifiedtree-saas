package com.hrms.api.fnf;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.fnf.dto.FnfSettlementRequest;
import com.hrms.fnf.dto.FnfSettlementResponse;
import com.hrms.fnf.service.FnfService;
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
 * Full &amp; Final settlement: HR processes a leaver's exit settlement (earnings −
 * deductions), Finance/HR approve it, and it is then marked paid. Tenant isolation
 * is enforced by RLS; employee identity is enriched at this (API) layer.
 */
@RestController
@RequestMapping("/v1/fnf")
@Tag(name = "Full & Final", description = "Exit settlements, components, approval, and payout")
@SecurityRequirement(name = "bearerAuth")
public class FnfController {

    private final FnfService fnfService;
    private final EmployeeRepository employeeRepository;

    public FnfController(FnfService fnfService, EmployeeRepository employeeRepository) {
        this.fnfService = fnfService;
        this.employeeRepository = employeeRepository;
    }

    // ─── Processing ──────────────────────────────────────────────────────────

    @Operation(summary = "Process a full & final settlement with its components")
    @PostMapping("/settlements")
    @PreAuthorize("@perm.check('hrms.fnf.process')")
    public ResponseEntity<FnfSettlementResponse> process(@Valid @RequestBody FnfSettlementRequest request) {
        Employee employee = employeeRepository.findById(request.employeeId())
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + request.employeeId()));
        UUID companyId = request.companyId() != null ? request.companyId() : employee.getCompanyId();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(fnfService.processSettlement(companyId, request)));
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    @Operation(summary = "List full & final settlements")
    @GetMapping("/settlements")
    @PreAuthorize("hasAuthority('hrms.fnf.read')")
    public ResponseEntity<PageResponse<FnfSettlementResponse>> list(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(fnfService.getSettlements(pageable)));
    }

    @Operation(summary = "Get a single full & final settlement with its components")
    @GetMapping("/settlements/{id}")
    @PreAuthorize("hasAuthority('hrms.fnf.read')")
    public ResponseEntity<FnfSettlementResponse> get(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(fnfService.getSettlement(id)));
    }

    // ─── Approval & payout ───────────────────────────────────────────────────

    @Operation(summary = "Approve a processed settlement")
    @PostMapping("/settlements/{id}/approve")
    @PreAuthorize("@perm.check('hrms.fnf.approve')")
    public ResponseEntity<FnfSettlementResponse> approve(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichOne(fnfService.approve(id, extractEmployeeId(jwt))));
    }

    @Operation(summary = "Mark an approved settlement as paid")
    @PostMapping("/settlements/{id}/pay")
    @PreAuthorize("@perm.check('hrms.fnf.approve')")
    public ResponseEntity<FnfSettlementResponse> pay(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(fnfService.pay(id)));
    }

    // ─── Employee identity enrichment ────────────────────────────────────────
    // The fnf module has no dependency on hrms-employee, so the leaver's name /
    // code are resolved here (the API layer) and folded into the response so
    // settlement cards can show WHOSE settlement it is.

    private PageResponse<FnfSettlementResponse> enrichPage(PageResponse<FnfSettlementResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .map(FnfSettlementResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        List<FnfSettlementResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId())))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private FnfSettlementResponse enrichOne(FnfSettlementResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        return enrich(r, employee);
    }

    private FnfSettlementResponse enrich(FnfSettlementResponse r, Employee employee) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + employee.getLastName()).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        return new FnfSettlementResponse(
                r.id(), r.employeeId(), employeeName, employeeCode, r.companyId(),
                r.lastWorkingDay(), r.status(), r.grossPayable(), r.totalDeductions(),
                r.netSettlement(), r.notes(), r.processedAt(), r.approvedAt(),
                r.paidAt(), r.approverId(), r.createdAt(), r.components());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
