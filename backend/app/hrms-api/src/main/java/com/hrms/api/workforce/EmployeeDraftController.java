package com.hrms.api.workforce;

import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * "Save draft" on Add employee (redesign BW-92). Drafts are personal: the
 * caller sees and changes only the drafts they saved themselves. PAN, Aadhaar,
 * passport, UAN, ESI and bank details are never stored (the service strips
 * them and says which it removed). Answers 503 FEATURE_NOT_READY until
 * V143_52 is applied.
 */
@RestController
@RequestMapping("/v1/hrms/employee-drafts")
public class EmployeeDraftController {

    private final EmployeeDraftService drafts;

    public EmployeeDraftController(EmployeeDraftService drafts) {
        this.drafts = drafts;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public List<EmployeeDraftService.Draft> list(@RequestParam(required = false) UUID companyId,
                                                 @AuthenticationPrincipal Jwt jwt) {
        return drafts.list(userId(jwt), companyId);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public EmployeeDraftService.Draft get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return drafts.get(userId(jwt), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public EmployeeDraftService.Draft create(@RequestBody EmployeeDraftService.SaveRequest req,
                                             @AuthenticationPrincipal Jwt jwt) {
        return drafts.create(userId(jwt), req);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public EmployeeDraftService.Draft update(@PathVariable UUID id,
                                             @RequestBody EmployeeDraftService.SaveRequest req,
                                             @AuthenticationPrincipal Jwt jwt) {
        return drafts.update(userId(jwt), id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public void delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        drafts.delete(userId(jwt), id);
    }

    /** The signed-in user (the token's subject); drafts are keyed on it. */
    static UUID userId(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null) {
            throw new org.springframework.security.access.AccessDeniedException("Sign in to use drafts");
        }
        return UUID.fromString(jwt.getSubject());
    }
}
