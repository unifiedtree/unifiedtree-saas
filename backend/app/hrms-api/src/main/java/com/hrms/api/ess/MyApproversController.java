package com.hrms.api.ess;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.hrms.api.ess.ApproverChainService.Choice;
import com.hrms.api.ess.ApproverChainService.Kind;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * "Send to Siddharth Rao": who a request of mine would go to, before I send it
 * (BW-122; contract C0 {@code useApprovers}).
 *
 * <p>Always the caller's own chain (identity from the token only), so it only
 * needs a signed-in user. {@code approver} is null when nobody can be found:
 * applying would then be refused with {@code NO_APPROVER_AVAILABLE}, or the
 * caller has no employee record.
 */
@RestController
@RequestMapping("/v1/me/approvers")
@Tag(name = "Self-service", description = "The signed-in person's own requests, tasks and events")
@SecurityRequirement(name = "bearerAuth")
public class MyApproversController {

    private final ApproverChainService chain;
    private final EmployeeRepository employees;

    public MyApproversController(ApproverChainService chain, EmployeeRepository employees) {
        this.chain = chain;
        this.employees = employees;
    }

    /** The approver as the web shows it. */
    public record Approver(String employeeId, String name, String source, String delegateForName) {}

    /** {@code for} is a Java keyword, hence the property name. */
    public record ApproverPreview(@JsonProperty("for") String kind, Approver approver) {}

    @Operation(summary = "Who a leave, work-from-home, fix or shift-change request of mine would go to")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public ApproverPreview preview(@RequestParam("for") String forKind, @AuthenticationPrincipal Jwt jwt) {
        Kind kind = Kind.of(forKind);
        if (kind == null) {
            throw new HrmsException("Ask for one of leave, wfh, correction or shift.", HttpStatus.BAD_REQUEST, "INVALID_PARAMETER");
        }
        Employee me = myEmployee(jwt);
        if (me == null) return new ApproverPreview(kind.key, null);
        Choice choice = chain.preview(me, kind);
        if (choice == null) return new ApproverPreview(kind.key, null);
        Employee approver = employees.findById(choice.approverId()).orElse(null);
        String delegateFor = choice.delegateForId() == null ? null
                : employees.findById(choice.delegateForId()).map(MyApproversController::fullName).orElse(null);
        return new ApproverPreview(kind.key, new Approver(choice.approverId().toString(),
                approver == null ? null : fullName(approver), choice.source().name(), delegateFor));
    }

    /** The caller's employee record, the same way the apply endpoints find it; null when there is none. */
    private Employee myEmployee(Jwt jwt) {
        if (jwt == null) return null;
        String raw = jwt.getClaimAsString("employee_id");
        if (raw == null || raw.isBlank()) raw = jwt.getSubject();
        try {
            return employees.findById(UUID.fromString(raw)).orElse(null);
        } catch (IllegalArgumentException | NullPointerException notAnId) {
            return null;
        }
    }

    static String fullName(Employee e) {
        String first = e.getFirstName() == null ? "" : e.getFirstName().trim();
        String last = e.getLastName() == null ? "" : e.getLastName().trim();
        String name = (first + " " + last).trim();
        return name.isEmpty() ? e.getEmployeeCode() : name;
    }
}
