package com.hrms.api.employee;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Backs the {@code @securityHelper} bean reference used by two
 * {@code @PreAuthorize} expressions on {@link EmployeeController}:
 *
 * <pre>
 *   hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN','DEPT_MANAGER')
 *     or (hasRole('EMPLOYEE') and #employeeId == &#64;securityHelper.currentEmployeeId())
 * </pre>
 *
 * <p><strong>This bean did not exist.</strong> It was referenced from those two
 * expressions and never written — a repo-wide search for "SecurityHelper"
 * returned only the two SpEL strings. Spring resolves bean references inside
 * {@code @PreAuthorize} lazily, at first evaluation, so the application started
 * cleanly and the gap only surfaced per-request as
 * {@code NoSuchBeanDefinitionException: No bean named 'securityHelper'} wrapped
 * in a 500.
 *
 * <p>It stayed invisible because SpEL short-circuits. An admin or HR user
 * satisfies the leading {@code hasAnyRole(...)}, so the {@code or} never
 * evaluates its right side. A user without the EMPLOYEE role fails
 * {@code hasRole('EMPLOYEE')}, so the {@code and} never evaluates its right
 * side either. ONLY a plain employee reaches the bean reference — and they got
 * a 500 opening their own employee record or their own emergency contacts.
 * Every role that could have noticed was structurally incapable of hitting it.
 *
 * <p>Returns the {@code employee_id} claim, which is what {@code #employeeId}
 * on those endpoints is compared against. Returns null when the principal has
 * no employee record; SpEL's {@code ==} maps to {@code equals()}, and a null
 * left operand simply makes the comparison false, so a credential with no
 * employee identity is denied rather than admitted.
 */
@Component("securityHelper")
public class SecurityHelper {

    public UUID currentEmployeeId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) {
            return null;
        }
        String claim = jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(claim.trim());
        } catch (IllegalArgumentException notAUuid) {
            return null;
        }
    }
}
