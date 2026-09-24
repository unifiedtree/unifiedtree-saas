package com.hrms.api.me;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Self-service approval delegation ("I'm away — approvals go to Alice from
 * Monday to Wednesday"). Any submit (leave / WFH / expense / advance / OT) that
 * would normally route to me while a delegation is active is redirected to my
 * delegate. Already-routed requests are not moved. Old rows (to_date in the
 * past) are hidden from the list.
 */
@RestController
@RequestMapping("/v1/me/delegation")
@SecurityRequirement(name = "bearerAuth")
public class ApprovalDelegationController {

    private final JdbcTemplate jdbc;
    private final EmployeeRepository employeeRepository;

    public ApprovalDelegationController(JdbcTemplate jdbc, EmployeeRepository employeeRepository) {
        this.jdbc = jdbc;
        this.employeeRepository = employeeRepository;
    }

    public record DelegationDto(UUID id, UUID delegateEmployeeId, String delegateName,
                                LocalDate fromDate, LocalDate toDate, String reason, boolean active) {}

    public record CreateRequest(
            @NotNull UUID delegateEmployeeId,
            @NotNull LocalDate fromDate,
            @NotNull LocalDate toDate,
            String reason) {}

    @Operation(summary = "Current + upcoming delegations for the logged-in user")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public List<DelegationDto> list(@AuthenticationPrincipal Jwt jwt) {
        UUID actor = actorEmployeeId(jwt);
        LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        return jdbc.query("""
                SELECT d.id, d.delegate_id, d.from_date, d.to_date, d.reason,
                       concat_ws(' ', e.first_name, e.last_name) AS delegate_name
                  FROM platform.approver_delegations d
                  LEFT JOIN hrms.employees e ON e.id = d.delegate_id AND e.tenant_id = d.tenant_id
                 WHERE d.delegator_id = ? AND d.to_date >= ?
                 ORDER BY d.from_date DESC
                """,
                (rs, i) -> new DelegationDto(
                        rs.getObject("id", UUID.class),
                        rs.getObject("delegate_id", UUID.class),
                        rs.getString("delegate_name"),
                        rs.getObject("from_date", LocalDate.class),
                        rs.getObject("to_date", LocalDate.class),
                        rs.getString("reason"),
                        !rs.getObject("from_date", LocalDate.class).isAfter(today)
                                && !rs.getObject("to_date", LocalDate.class).isBefore(today)),
                actor, java.sql.Date.valueOf(today));
    }

    @Operation(summary = "Create a delegation window")
    @PostMapping
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public ResponseEntity<Map<String, String>> create(@Valid @RequestBody CreateRequest body,
                                                      @AuthenticationPrincipal Jwt jwt) {
        UUID actor = actorEmployeeId(jwt);
        UUID tenant = TenantContext.getTenantId();
        LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        if (body.delegateEmployeeId().equals(actor)) {
            throw new BusinessRuleException("You cannot delegate to yourself.", "DELEGATION_SELF");
        }
        if (body.toDate().isBefore(body.fromDate())) {
            throw new BusinessRuleException("End date must be on or after start date.", "DELEGATION_DATE_INVALID");
        }
        if (body.toDate().isBefore(today)) {
            throw new BusinessRuleException("End date cannot be in the past.", "DELEGATION_DATE_PAST");
        }
        if (body.fromDate().isAfter(today.plusYears(1))) {
            throw new BusinessRuleException("Choose a start date within the next 12 months.", "DELEGATION_DATE_TOO_FAR");
        }
        // Delegate must be a real, current employee in this tenant.
        Employee delegate = employeeRepository.findById(body.delegateEmployeeId())
                .orElseThrow(() -> new BusinessRuleException("Delegate employee not found.", "DELEGATION_DELEGATE_UNKNOWN"));
        com.hrms.core.enums.EmploymentStatus st = delegate.getEmploymentStatus();
        if (st == com.hrms.core.enums.EmploymentStatus.EXITED
                || st == com.hrms.core.enums.EmploymentStatus.TERMINATED
                || st == com.hrms.core.enums.EmploymentStatus.SUSPENDED) {
            throw new BusinessRuleException("Choose an active employee as your delegate.", "DELEGATION_DELEGATE_INACTIVE");
        }
        // Overlap check with any existing window that still covers a future day.
        Integer overlap = jdbc.queryForObject("""
                SELECT count(*) FROM platform.approver_delegations
                 WHERE delegator_id = ?
                   AND to_date >= ?
                   AND from_date <= ?
                   AND to_date   >= ?
                """, Integer.class, actor, java.sql.Date.valueOf(today),
                java.sql.Date.valueOf(body.toDate()), java.sql.Date.valueOf(body.fromDate()));
        if (overlap != null && overlap > 0) {
            throw new BusinessRuleException(
                    "You already have a delegation covering that period. Delete it first.",
                    "DELEGATION_OVERLAP");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO platform.approver_delegations
                    (id, tenant_id, delegator_id, delegate_id, from_date, to_date, reason)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, id, tenant, actor, body.delegateEmployeeId(),
                java.sql.Date.valueOf(body.fromDate()), java.sql.Date.valueOf(body.toDate()),
                body.reason());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id.toString()));
    }

    @Operation(summary = "Delete a delegation")
    @DeleteMapping("/{id}")
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public void delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        UUID actor = actorEmployeeId(jwt);
        int n = jdbc.update("DELETE FROM platform.approver_delegations WHERE id = ? AND delegator_id = ?", id, actor);
        if (n == 0) throw new BusinessRuleException("Delegation not found.", "DELEGATION_NOT_FOUND");
    }

    private static UUID actorEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
