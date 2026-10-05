package com.hrms.api.access;

import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.company.CompanyAccessService.CompanyAccessView;
import com.unifiedtree.rbac.company.CompanyAccessService.GrantRow;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Company access (docs/redesign/COMPANY_ACCESS.md): which companies a person may
 * work in and their role(s) in each. Clients choose the current company with the
 * {@code X-Company-Id} header (checked by CompanyAccessFilter).
 */
@RestController
public class CompanyAccessController {

    private final CompanyAccessService access;
    private final CompanyAccessAdminService admin;

    public CompanyAccessController(CompanyAccessService access, CompanyAccessAdminService admin) {
        this.access = access;
        this.admin = admin;
    }

    /** The signed-in person's companies (home first) with their role(s) in each: the company selector's list. */
    @GetMapping("/v1/me/companies")
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public CompanyAccessView myCompanies() {
        return access.myCompanies();
    }

    /** One person's companies and roles (archived companies included). */
    @GetMapping("/v1/workspace/users/{userId}/company-access")
    @PreAuthorize("hasAuthority('workspace.users.read')")
    public CompanyAccessView userCompanies(@PathVariable UUID userId) {
        return admin.view(userId);
    }

    /** Give a person a role in a company other than their home company. */
    @PostMapping("/v1/workspace/users/{userId}/company-access")
    @PreAuthorize("hasAuthority('workspace.users.manage')")
    public CompanyAccessView grant(@PathVariable UUID userId,
                                   @RequestBody CompanyAccessAdminService.GrantRequest req,
                                   @AuthenticationPrincipal Jwt jwt) {
        return admin.grant(userId, req, UUID.fromString(jwt.getSubject()));
    }

    /** Take away one role ({@code roleCode}) or all of a person's access to a company. */
    @DeleteMapping("/v1/workspace/users/{userId}/company-access/{companyId}")
    @PreAuthorize("hasAuthority('workspace.users.manage')")
    public CompanyAccessView revoke(@PathVariable UUID userId,
                                    @PathVariable UUID companyId,
                                    @RequestParam(required = false) String roleCode,
                                    @AuthenticationPrincipal Jwt jwt) {
        return admin.revoke(userId, companyId, roleCode, UUID.fromString(jwt.getSubject()));
    }

    /** Every company grant in the workspace (Roles &amp; Access, billing), optionally for one company. */
    @GetMapping("/v1/workspace/company-access")
    @PreAuthorize("hasAuthority('workspace.users.read')")
    public List<GrantRow> listGrants(@RequestParam(required = false) UUID companyId) {
        return admin.listGrants(companyId);
    }
}
