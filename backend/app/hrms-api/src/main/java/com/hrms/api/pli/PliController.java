package com.hrms.api.pli;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.pli.dto.PliAwardRequest;
import com.hrms.pli.dto.PliAwardResponse;
import com.hrms.pli.dto.PliDecisionRequest;
import com.hrms.pli.dto.PliTargetRequest;
import com.hrms.pli.dto.PliTargetResponse;
import com.hrms.pli.service.PliService;
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
 * Performance-Linked Incentives: HR/Finance propose incentive awards for
 * employees, approve or reject them, and mark approved awards as paid.
 * Employees see their own incentives via self-service.
 */
@RestController
@RequestMapping("/v1/pli")
@Tag(name = "PLI", description = "Performance-linked incentive awards, approval, and payout")
@SecurityRequirement(name = "bearerAuth")
public class PliController {

    private final PliService pliService;
    private final EmployeeRepository employeeRepository;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public PliController(PliService pliService,
                         EmployeeRepository employeeRepository,
                         org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.pliService = pliService;
        this.employeeRepository = employeeRepository;
        this.jdbc = jdbc;
    }

    @Operation(summary = "List PLI targets")
    @GetMapping("/targets")
    @PreAuthorize("hasAnyAuthority('hrms.pli.target.read','hrms.pli.read')")
    public ResponseEntity<PageResponse<PliTargetResponse>> listTargets(
            @RequestParam(required = false) UUID companyId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(pliService.getTargets(companyId, pageable));
    }

    @Operation(summary = "Create a PLI target")
    @PostMapping("/targets")
    @PreAuthorize("hasAnyAuthority('hrms.pli.target.write','hrms.pli.write')")
    public ResponseEntity<PliTargetResponse> createTarget(@Valid @RequestBody PliTargetRequest request,
                                                          @AuthenticationPrincipal Jwt jwt) {
        UUID companyId = request.companyId();
        if (companyId == null) {
            UUID employeeId = extractEmployeeId(jwt);
            Employee employee = employeeRepository.findById(employeeId)
                    .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
            companyId = employee.getCompanyId();
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(pliService.createTarget(companyId, request));
    }

    @Operation(summary = "Update a PLI target")
    @PutMapping("/targets/{id}")
    @PreAuthorize("hasAnyAuthority('hrms.pli.target.write','hrms.pli.write')")
    public ResponseEntity<PliTargetResponse> updateTarget(@PathVariable UUID id,
                                                          @Valid @RequestBody PliTargetRequest request) {
        return ResponseEntity.ok(pliService.updateTarget(id, request));
    }

    // ─── Administration (HR / Finance) ───────────────────────────────────────

    @Operation(summary = "Propose a performance-linked incentive award for an employee")
    @PostMapping("/awards")
    @PreAuthorize("hasAuthority('hrms.pli.write')")
    public ResponseEntity<PliAwardResponse> create(@Valid @RequestBody PliAwardRequest request) {
        UUID employeeId = request.employeeId();
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        UUID companyId = request.companyId() != null ? request.companyId() : employee.getCompanyId();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(pliService.createAward(employeeId, companyId, request)));
    }

    @Operation(summary = "List all incentive awards")
    @GetMapping("/awards")
    @PreAuthorize("hasAuthority('hrms.pli.read')")
    public ResponseEntity<PageResponse<PliAwardResponse>> listAwards(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(pliService.getAllAwards(pageable)));
    }

    @Operation(summary = "Approve or reject a proposed incentive award")
    @PostMapping("/awards/{id}/decision")
    @PreAuthorize("hasAuthority('hrms.pli.write')")
    public ResponseEntity<PliAwardResponse> decide(
            @PathVariable UUID id,
            @Valid @RequestBody PliDecisionRequest decision) {
        return ResponseEntity.ok(enrichOne(pliService.decide(id, decision)));
    }

    @Operation(summary = "Mark an approved incentive award as paid")
    @PostMapping("/awards/{id}/pay")
    @PreAuthorize("hasAuthority('hrms.pli.write')")
    public ResponseEntity<PliAwardResponse> pay(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(pliService.pay(id)));
    }

    // ─── Employee self-service ───────────────────────────────────────────────

    @Operation(summary = "Get my incentive awards")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('hrms.pli.read.self')")
    public ResponseEntity<PageResponse<PliAwardResponse>> myAwards(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        PageResponse<PliAwardResponse> page = pliService.getMyAwards(extractEmployeeId(jwt), pageable);
        Map<UUID, String> runs = runLabels(page.content());
        return ResponseEntity.ok(new PageResponse<>(
                page.content().stream().map(r -> withRun(r, r.employeeName(), r.employeeCode(), runs)).toList(),
                page.page(), page.size(), page.totalElements(), page.totalPages(), page.last()));
    }

    // ─── Awardee identity enrichment ─────────────────────────────────────────
    // The PLI module has no dependency on hrms-employee, so the awardee's name /
    // code are resolved here (the API layer) and folded into the response so the
    // admin award list can show WHO each incentive is for.

    private PageResponse<PliAwardResponse> enrichPage(PageResponse<PliAwardResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .map(PliAwardResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        Map<UUID, String> runs = runLabels(page.content());
        List<PliAwardResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId()), runs))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private PliAwardResponse enrichOne(PliAwardResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        return enrich(r, employee, runLabels(List.of(r)));
    }

    private PliAwardResponse enrich(PliAwardResponse r, Employee employee, Map<UUID, String> runs) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + (employee.getLastName() == null ? "" : employee.getLastName())).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        return withRun(r, employeeName, employeeCode, runs);
    }

    private static PliAwardResponse withRun(PliAwardResponse r, String employeeName, String employeeCode,
                                            Map<UUID, String> runs) {
        return new PliAwardResponse(
                r.id(), r.employeeId(), employeeName, employeeCode, r.companyId(),
                r.planName(), r.period(), r.amount(), r.ratingBasis(),
                r.status(), r.notes(), r.createdAt(),
                r.approvedAt(), r.payrollRunId(),
                r.payrollRunId() == null ? null : runs.get(r.payrollRunId()), r.paidAt());
    }

    /**
     * "Sep 2026" for every payroll run that pays one of these awards (awards
     * are paid through payroll since V143.11). Read on the request thread, so
     * the tenant's row-level security applies.
     */
    private Map<UUID, String> runLabels(List<PliAwardResponse> awards) {
        List<UUID> ids = awards.stream().map(PliAwardResponse::payrollRunId).filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        Map<UUID, String> out = new java.util.HashMap<>();
        String in = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        jdbc.query("SELECT id, period_month, period_year FROM payroll.runs WHERE id IN (" + in + ")",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class),
                        java.time.Month.of(rs.getInt("period_month"))
                                .getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH)
                                + " " + rs.getInt("period_year")),
                ids.toArray());
        return out;
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
