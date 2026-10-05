package com.hrms.api.employee;

import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.service.EmployeeContactGuard;
import com.hrms.employee.service.EmployeeContactGuard.Owner;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The checks the add / edit / invite forms make as you type (debounced), so a
 * taken email shows on the field before Save. The save itself checks again
 * (EmployeeContactGuard, 409 EMAIL_ALREADY_USED); these only tell the form early.
 *
 * <ul>
 *   <li>{@code GET /v1/employees/email-check?email=&excludeEmployeeId=} →
 *       {@code {available, ownerName?, ownerCode?, ownerLeft, field?, message?}}</li>
 *   <li>{@code GET /v1/employees/phone-check?phone=&excludeEmployeeId=} →
 *       {@code {inUse, count, usedBy[{name, code, left}], message?}} — a warning only;
 *       people do share numbers.</li>
 * </ul>
 * Who the other person is comes back only to callers who read or edit every
 * employee record; anyone else gets a message without a name.
 */
@RestController
@RequestMapping("/v1/employees")
@Tag(name = "Employees", description = "Employee master data and lifecycle management")
@SecurityRequirement(name = "bearerAuth")
public class EmployeeContactCheckController {

    /** The people who add or edit employees (both create endpoints) or invite logins (Users & access). */
    static final String ADD_OR_EDIT = "hasAuthority('hrms.employee.write') or @perm.check('hrms.employee.team.manage')"
            + " or @perm.check('workspace.users.manage')";

    private final EmployeeContactGuard guard;

    public EmployeeContactCheckController(EmployeeContactGuard guard) {
        this.guard = guard;
    }

    public record EmailCheck(boolean available, String ownerName, String ownerCode, boolean ownerLeft,
                             String field, String message) {}

    public record PhoneUser(String name, String code, boolean left) {}

    public record PhoneCheck(boolean inUse, int count, List<PhoneUser> usedBy, String message) {}

    @Operation(summary = "Whether an email is free for this employee (work, personal and login emails of everyone else in the workspace)")
    @GetMapping("/email-check")
    @PreAuthorize(ADD_OR_EDIT)
    public EmailCheck emailCheck(@RequestParam(required = false) String email,
                                 @RequestParam(required = false) UUID excludeEmployeeId) {
        Optional<Owner> owner = guard.emailOwner(TenantContext.getTenantId(), email, excludeEmployeeId);
        if (owner.isEmpty()) return new EmailCheck(true, null, null, false, null, null);
        Owner o = owner.get();
        boolean reveal = EmployeeContactGuard.callerMaySeeOwners();
        return new EmailCheck(false,
                reveal ? o.name() : null, reveal ? o.code() : null, reveal && o.left(),
                reveal ? o.field().name() : null,
                EmployeeContactGuard.conflictMessage(o, reveal));
    }

    @Operation(summary = "Who else in the workspace has this phone number (a warning, never a refusal)")
    @GetMapping("/phone-check")
    @PreAuthorize(ADD_OR_EDIT)
    public PhoneCheck phoneCheck(@RequestParam(required = false) String phone,
                                 @RequestParam(required = false) UUID excludeEmployeeId) {
        List<Owner> owners = guard.phoneOwners(TenantContext.getTenantId(), phone, excludeEmployeeId);
        if (owners.isEmpty()) return new PhoneCheck(false, 0, List.of(), null);
        boolean reveal = EmployeeContactGuard.callerMaySeeOwners();
        List<PhoneUser> users = reveal
                ? owners.stream().map(o -> new PhoneUser(o.name(), o.code(), o.left())).toList()
                : List.of();
        return new PhoneCheck(true, owners.size(), users, EmployeeContactGuard.phoneWarning(owners, reveal));
    }
}
