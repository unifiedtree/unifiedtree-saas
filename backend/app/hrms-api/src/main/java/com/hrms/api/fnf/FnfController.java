package com.hrms.api.fnf;

import com.hrms.api.access.RecordCompanyGuard;
import com.hrms.core.dto.ListDateRange;
import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.fnf.dto.FnfSettlementRequest;
import com.hrms.fnf.dto.FnfSettlementResponse;
import com.hrms.fnf.enums.FnfStatus;
import com.hrms.fnf.service.FnfService;
import com.hrms.api.advance.PayFinancialYear;
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
 * Full &amp; Final settlement: HR processes a leaver's exit settlement (earnings −
 * deductions), Finance/HR approve it, and it is then marked paid. Tenant isolation
 * is enforced by RLS; employee identity is enriched at this (API) layer.
 */
@RestController
@RequestMapping("/v1/fnf")
@Tag(name = "Full & Final", description = "Exit settlements, components, approval, and payout")
@SecurityRequirement(name = "bearerAuth")
public class FnfController {

    /** Company access: a record addressed by id must be in a company the caller may work in (COMPANY_ACCESS.md). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private RecordCompanyGuard recordGuard;

    private final FnfService fnfService;
    private final EmployeeRepository employeeRepository;
    private final FnfReadService reads;
    private final WorkforceDepartmentRepository departmentRepository;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public FnfController(FnfService fnfService, EmployeeRepository employeeRepository, FnfReadService reads,
                         WorkforceDepartmentRepository departmentRepository,
                         org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.fnfService = fnfService;
        this.employeeRepository = employeeRepository;
        this.reads = reads;
        this.departmentRepository = departmentRepository;
        this.jdbc = jdbc;
    }

    // ─── Processing ──────────────────────────────────────────────────────────

    @Operation(summary = "Process a full & final settlement with its components")
    @PostMapping("/settlements")
    @PreAuthorize("@perm.check('hrms.fnf.process')")
    public ResponseEntity<FnfSettlementResponse> process(@Valid @RequestBody FnfSettlementRequest request) {
        RecordCompanyGuard.checkEmployee(recordGuard, request.employeeId());
        // QA-FIX (2026-08-13 reverify R1): was throwing IllegalArgumentException which
        // fell through GlobalExceptionHandler to a 500 INTERNAL_ERROR, masking the real
        // "employee not found" from clients. Use HrmsException(NOT_FOUND) so it maps to
        // 404 EMPLOYEE_NOT_FOUND — matches the service-layer guard added in fix bundle B.
        Employee employee = employeeRepository.findById(request.employeeId())
                .orElseThrow(() -> new com.hrms.core.exception.HrmsException(
                        "Employee not found: " + request.employeeId(),
                        org.springframework.http.HttpStatus.NOT_FOUND,
                        "EMPLOYEE_NOT_FOUND"));
        UUID companyId = request.companyId() != null ? request.companyId() : employee.getCompanyId();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(fnfService.processSettlement(companyId, request)));
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    @Operation(summary = "List full & final settlements, optionally by status (comma-separated), one employee and/or a range of last working days (?from=&to=, both included)")
    @GetMapping("/settlements")
    @PreAuthorize("hasAuthority('hrms.fnf.read')")
    public ResponseEntity<PageResponse<FnfSettlementResponse>> list(
            @RequestParam(required = false) List<FnfStatus> status,
            @RequestParam(required = false) UUID employeeId,
            @PageableDefault(size = 20) Pageable pageable,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        ListDateRange range = ListDateRange.parse(from, to);
        RecordCompanyGuard.checkEmployee(recordGuard, employeeId);
        // No filter = today's call exactly (BW-64 adds the two optional filters; calendar everywhere, 7 Oct 2026, the range).
        return ResponseEntity.ok(enrichPage(range == null ? fnfService.getSettlements(status, employeeId, pageable)
                : fnfService.getSettlements(status, employeeId, range.from(), range.to(), pageable)));
    }

    /**
     * Each person's most recent settlement (any status, CANCELLED included),
     * one row per id in the order asked, nulls when none was started (BW-64,
     * shared hook useFnfStatus). Mapped explicitly so this literal path wins
     * over {@code /settlements/{id}}, which used to answer it with a 400.
     */
    @Operation(summary = "Full & final status of each of these employees (their most recent settlement)")
    @GetMapping("/settlements/status")
    @PreAuthorize("hasAuthority('hrms.fnf.read')")
    public ResponseEntity<List<FnfReadService.FnfStatusRow>> statusFor(
            @RequestParam(required = false) String employeeIds) {
        return ResponseEntity.ok(reads.statusFor(com.hrms.core.tenant.TenantContext.getTenantId(),
                FnfReadService.parseIds(employeeIds)));
    }

    @Operation(summary = "Totals of the settlements ledger: waiting for approval, to be paid, settled, paid this financial year")
    @GetMapping("/summary")
    @PreAuthorize("hasAuthority('hrms.fnf.read')")
    public ResponseEntity<FnfReadService.FnfSummary> summary(@AuthenticationPrincipal Jwt jwt) {
        UUID tenantId = com.hrms.core.tenant.TenantContext.getTenantId();
        UUID caller = jwt == null ? null : extractEmployeeId(jwt);
        PayFinancialYear year = PayFinancialYear.of(jdbc, tenantId, caller,
                java.time.LocalDate.now(PayFinancialYear.IST));
        return ResponseEntity.ok(reads.summary(tenantId, year));
    }

    @Operation(summary = "Get a single full & final settlement with its components")
    @GetMapping("/settlements/{id}")
    @PreAuthorize("hasAuthority('hrms.fnf.read')")
    public ResponseEntity<FnfSettlementResponse> get(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.FNF_SETTLEMENT, id);
        return ResponseEntity.ok(enrichOne(fnfService.getSettlement(id)));
    }

    // ─── Approval & payout ───────────────────────────────────────────────────

    @Operation(summary = "Approve a processed settlement")
    @PostMapping("/settlements/{id}/approve")
    @PreAuthorize("@perm.check('hrms.fnf.approve')")
    public ResponseEntity<FnfSettlementResponse> approve(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.FNF_SETTLEMENT, id);
        return ResponseEntity.ok(enrichOne(fnfService.approve(id, extractEmployeeId(jwt))));
    }

    @Operation(summary = "Mark an approved settlement as paid")
    @PostMapping("/settlements/{id}/pay")
    // B3 FIX (audit 2026-08-15): pay requires the dedicated hrms.fnf.pay
    // permission (segregation of duties from hrms.fnf.approve). Migration
    // V101__fnf_perm_split.sql grants both to existing approve holders on
    // apply, and the frontend re-uses the same admin flow to grant pay to
    // the finance role explicitly.
    @PreAuthorize("@perm.check('hrms.fnf.pay')")
    public ResponseEntity<FnfSettlementResponse> pay(@PathVariable UUID id,
                                                     @AuthenticationPrincipal Jwt jwt) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.FNF_SETTLEMENT, id);
        // Disburser != requester (segregation of duties).
        FnfSettlementResponse existing = fnfService.getSettlement(id);
        UUID caller = jwt == null ? null : extractEmployeeId(jwt);
        if (caller != null && caller.equals(existing.employeeId())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You cannot mark your own FnF settlement as paid.");
        }
        // Approver != payer (segregation of duties).
        if (caller != null && existing.approverId() != null && caller.equals(existing.approverId())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "The approver cannot also mark the settlement paid — a different user must record payout.");
        }
        return ResponseEntity.ok(enrichOne(fnfService.pay(id)));
    }

    @PostMapping("/settlements/{id}/cancel")
    @PreAuthorize("@perm.check('hrms.fnf.process')")
    public ResponseEntity<FnfSettlementResponse> cancel(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.FNF_SETTLEMENT, id);
        return ResponseEntity.ok(enrichOne(fnfService.cancel(id)));
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
        Map<UUID, String> departments = departmentNames(employeeMap.values());
        List<FnfSettlementResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId()), departments))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private FnfSettlementResponse enrichOne(FnfSettlementResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        return enrich(r, employee, employee == null ? Map.of() : departmentNames(List.of(employee)));
    }

    private FnfSettlementResponse enrich(FnfSettlementResponse r, Employee employee, Map<UUID, String> departments) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + (employee.getLastName() == null ? "" : employee.getLastName())).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        return new FnfSettlementResponse(
                r.id(), r.employeeId(), employeeName, employeeCode, r.companyId(),
                r.lastWorkingDay(), r.status(), r.grossPayable(), r.totalDeductions(),
                r.netSettlement(), r.notes(), r.processedAt(), r.approvedAt(),
                r.paidAt(), r.approverId(), r.createdAt(), r.components(),
                employee != null ? employee.getDepartmentId() : null,
                employee != null && employee.getDepartmentId() != null ? departments.get(employee.getDepartmentId()) : null,
                employee != null && employee.getEmploymentStatus() != null ? employee.getEmploymentStatus().name() : null);
    }

    private Map<UUID, String> departmentNames(java.util.Collection<Employee> employees) {
        List<UUID> ids = employees.stream().map(Employee::getDepartmentId).filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        Map<UUID, String> names = new java.util.HashMap<>();
        departmentRepository.findAllById(ids).forEach(d -> names.put(d.getId(), d.getName()));
        return names;
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
