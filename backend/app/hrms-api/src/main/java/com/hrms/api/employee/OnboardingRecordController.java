package com.hrms.api.employee;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.employee.repository.EmployeeRepository;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Supplementary HR onboarding record. Core identity/payroll fields remain in their existing stores. */
@RestController
@RequestMapping("/v1/hrms/employees/{employeeId}/onboarding-record")
@PreAuthorize("hasAuthority('hrms.employee.write')")
public class OnboardingRecordController {
    private static final Set<String> DETAIL_FIELDS = Set.of("permanentAddress", "probation", "noticePeriod", "accountType",
            "pfEnrolled", "esiEnrolled", "gratuityEligible", "insurancePlan", "orientationTime", "assignedLaptop", "idCardStatus", "accessCardStatus");
    private final JdbcTemplate jdbc;
    private final EmployeeRepository employees;
    private final ObjectMapper mapper;
    public OnboardingRecordController(JdbcTemplate jdbc, EmployeeRepository employees, ObjectMapper mapper) {
        this.jdbc = jdbc; this.employees = employees; this.mapper = mapper;
    }
    public record RecordRequest(
            @Size(max=30) Map<@Size(max=60) String, @Size(max=2000) String> details,
            @Size(max=100) List<@Valid Asset> assets,
            @Size(max=100) List<@Size(max=200) String> selectedPolicies,
            @Size(max=50) Map<@Size(max=100) String, Boolean> joiningChecklist,
            @Size(max=30) Map<@Size(max=100) String, @Valid DocumentCheck> documentChecklist) {}
    public record Asset(@Size(max=100) String type, @Size(max=200) String model,
                        @Size(max=100) String serial, @Size(max=20) String issuedOn) {}
    public record DocumentCheck(@Size(max=255) String fileName, @Size(max=30) String status) {}

    private UUID bindAndCheck(UUID employeeId) {
        UUID tenant = TenantContext.getTenantId();
        if (tenant == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenant.toString());
        if (employees.findById(employeeId).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found");
        return tenant;
    }

    @GetMapping
    @Transactional(readOnly=true)
    public JsonNode get(@PathVariable UUID employeeId) {
        UUID tenant = bindAndCheck(employeeId);
        List<String> records = jdbc.query("SELECT details::text FROM hrms.employee_onboarding_records WHERE tenant_id=? AND employee_id=?",
                (rs, i) -> rs.getString(1), tenant, employeeId);
        if (records.isEmpty()) return mapper.createObjectNode();
        try {
            JsonNode result = mapper.readTree(records.getFirst());
            if (result.get("details") instanceof com.fasterxml.jackson.databind.node.ObjectNode details) {
                details.retain(DETAIL_FIELDS);
            }
            return result;
        }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException("Invalid onboarding record", e); }
    }

    @PutMapping
    @Transactional
    public RecordRequest save(@PathVariable UUID employeeId, @Valid @RequestBody RecordRequest record, @AuthenticationPrincipal Jwt jwt) {
        if (record.details() != null && !DETAIL_FIELDS.containsAll(record.details().keySet())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Use the employee payroll, bank or identity section for protected fields");
        }
        UUID tenant = bindAndCheck(employeeId);
        String json;
        try { json = mapper.writeValueAsString(record); }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid onboarding record"); }
        jdbc.update("INSERT INTO hrms.employee_onboarding_records(tenant_id,employee_id,details,updated_by) VALUES(?,?,?::jsonb,?) "
                + "ON CONFLICT(tenant_id,employee_id) DO UPDATE SET details=excluded.details,updated_at=now(),updated_by=excluded.updated_by",
                tenant, employeeId, json, UUID.fromString(jwt.getSubject()));
        return record;
    }
}
