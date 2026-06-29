package com.hrms.api.policy;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.policy.dto.AcknowledgementResponse;
import com.hrms.policy.dto.PolicyRequest;
import com.hrms.policy.dto.PolicyResponse;
import com.hrms.policy.service.PolicyService;
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
 * HR policies: publication and administration of company policies, plus employee
 * self-service acknowledgement and acknowledgement reporting.
 */
@RestController
@RequestMapping("/v1/policy")
@Tag(name = "Policies", description = "HR policy publication and employee acknowledgements")
@SecurityRequirement(name = "bearerAuth")
public class PolicyController {

    private final PolicyService policyService;
    private final EmployeeRepository employeeRepository;

    public PolicyController(PolicyService policyService,
                            EmployeeRepository employeeRepository) {
        this.policyService = policyService;
        this.employeeRepository = employeeRepository;
    }

    // ─── Policy administration ───────────────────────────────────────────────

    @Operation(summary = "Publish a new HR policy")
    @PostMapping("/policies")
    @PreAuthorize("hasAuthority('hrms.policy.write')")
    public ResponseEntity<PolicyResponse> createPolicy(
            @Valid @RequestBody PolicyRequest request,
            @RequestParam(required = false) UUID companyId,
            @AuthenticationPrincipal Jwt jwt) {
        UUID resolvedCompany = companyId;
        if (resolvedCompany == null && request.companyId() == null) {
            Employee caller = employeeRepository.findById(extractEmployeeId(jwt)).orElse(null);
            if (caller != null) {
                resolvedCompany = caller.getCompanyId();
            }
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(policyService.createPolicy(resolvedCompany, request));
    }

    @Operation(summary = "List active HR policies")
    @GetMapping("/policies")
    @PreAuthorize("hasAuthority('hrms.policy.read')")
    public ResponseEntity<PageResponse<PolicyResponse>> listPolicies(
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(policyService.listActivePolicies(pageable));
    }

    @Operation(summary = "Get a single HR policy")
    @GetMapping("/policies/{id}")
    @PreAuthorize("hasAuthority('hrms.policy.read')")
    public ResponseEntity<PolicyResponse> getPolicy(@PathVariable UUID id) {
        return ResponseEntity.ok(policyService.getPolicy(id));
    }

    @Operation(summary = "Update an HR policy")
    @PutMapping("/policies/{id}")
    @PreAuthorize("hasAuthority('hrms.policy.write')")
    public ResponseEntity<PolicyResponse> updatePolicy(
            @PathVariable UUID id,
            @Valid @RequestBody PolicyRequest request) {
        return ResponseEntity.ok(policyService.updatePolicy(id, request));
    }

    @Operation(summary = "Archive an HR policy")
    @PostMapping("/policies/{id}/archive")
    @PreAuthorize("hasAuthority('hrms.policy.write')")
    public ResponseEntity<PolicyResponse> archivePolicy(@PathVariable UUID id) {
        return ResponseEntity.ok(policyService.archivePolicy(id));
    }

    // ─── Employee acknowledgement (self-service) ─────────────────────────────

    @Operation(summary = "Acknowledge a policy as the current employee")
    @PostMapping("/policies/{id}/acknowledge")
    @PreAuthorize("hasAuthority('hrms.policy.acknowledge.self')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void acknowledge(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        policyService.acknowledge(id, extractEmployeeId(jwt));
    }

    @Operation(summary = "List policy ids the current employee has acknowledged")
    @GetMapping("/my-acknowledgements")
    @PreAuthorize("hasAuthority('hrms.policy.acknowledge.self')")
    public ResponseEntity<List<UUID>> myAcknowledgements(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(policyService.getMyAcknowledgedPolicyIds(extractEmployeeId(jwt)));
    }

    // ─── Acknowledgement reporting ───────────────────────────────────────────

    @Operation(summary = "List employees who acknowledged a policy")
    @GetMapping("/policies/{id}/acknowledgements")
    @PreAuthorize("hasAuthority('hrms.policy.read')")
    public ResponseEntity<PageResponse<AcknowledgementResponse>> acknowledgements(
            @PathVariable UUID id,
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(policyService.getAcknowledgements(id, pageable)));
    }

    // ─── Acknowledger identity enrichment ────────────────────────────────────
    // The policy module has no dependency on hrms-employee, so the acknowledging
    // employee's name / code are resolved here (the API layer) and folded into
    // the response so admin views can show WHO acknowledged.

    private PageResponse<AcknowledgementResponse> enrichPage(PageResponse<AcknowledgementResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .map(AcknowledgementResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        List<AcknowledgementResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId())))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private AcknowledgementResponse enrich(AcknowledgementResponse r, Employee employee) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + (employee.getLastName() == null ? "" : employee.getLastName())).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        return new AcknowledgementResponse(
                r.id(), r.policyId(), r.employeeId(), employeeName, employeeCode, r.acknowledgedAt());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
