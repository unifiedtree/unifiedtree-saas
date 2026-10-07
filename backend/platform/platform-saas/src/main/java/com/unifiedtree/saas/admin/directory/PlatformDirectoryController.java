package com.unifiedtree.saas.admin.directory;

import com.unifiedtree.saas.admin.directory.PlatformDirectoryService.AccountRow;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryService.CompanyDetail;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryService.CompanyRow;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryService.WorkspaceDetail;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryService.WorkspaceRow;
import com.unifiedtree.saas.admin.support.PageResult;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Customer directory for the UnifiedTree admin console: workspaces, companies,
 * accounts. Read-only. Every route needs a platform token
 * ({@code @platformAdmin.check}) AND the matching permission, and the security
 * chain additionally requires role PLATFORM_SUPER_ADMIN on /v1/platform/admin/**.
 * Workspace reads reuse the existing platform.tenant.read.
 */
@RestController
@RequestMapping("/v1/platform/admin")
public class PlatformDirectoryController {

    private final PlatformDirectoryService directory;

    public PlatformDirectoryController(PlatformDirectoryService directory) {
        this.directory = directory;
    }

    /** Who is signed in. The admin console's session check, and Marketing's operator check. */
    public record OperatorProfile(UUID userId, String email, List<String> roles, List<String> permissions) {}

    @GetMapping("/me")
    @PreAuthorize("@platformAdmin.check(authentication)")
    public OperatorProfile me(@AuthenticationPrincipal Jwt jwt, Authentication auth) {
        List<String> authorities = auth.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList();
        return new OperatorProfile(UUID.fromString(jwt.getSubject()), jwt.getClaimAsString("email"),
                authorities.stream().filter(a -> a.startsWith("ROLE_")).map(a -> a.substring(5)).sorted().toList(),
                authorities.stream().filter(a -> !a.startsWith("ROLE_")).sorted().toList());
    }

    @GetMapping("/workspaces")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.tenant.read')")
    public PageResult<WorkspaceRow> workspaces(@RequestParam(required = false) String search,
                                               @RequestParam(required = false) String status,
                                               @RequestParam(required = false) Integer page,
                                               @RequestParam(required = false) Integer size) {
        return directory.workspaces(search, status, PageResult.page(page), PageResult.size(size));
    }

    @GetMapping("/workspaces/{tenantId}")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.tenant.read')")
    public WorkspaceDetail workspace(@PathVariable UUID tenantId) {
        return directory.workspace(tenantId);
    }

    @GetMapping("/companies")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.company.read')")
    public PageResult<CompanyRow> companies(@RequestParam(required = false) UUID tenantId,
                                            @RequestParam(required = false) String search,
                                            @RequestParam(required = false) Boolean active,
                                            @RequestParam(required = false) String product,
                                            @RequestParam(required = false) Integer page,
                                            @RequestParam(required = false) Integer size) {
        return directory.companies(tenantId, search, active, product, PageResult.page(page), PageResult.size(size));
    }

    @GetMapping("/workspaces/{tenantId}/companies/{companyId}")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.company.read')")
    public CompanyDetail company(@PathVariable UUID tenantId, @PathVariable UUID companyId) {
        return directory.company(tenantId, companyId);
    }

    @GetMapping("/accounts")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.account.read')")
    public PageResult<AccountRow> accounts(@RequestParam(required = false) String search,
                                           @RequestParam(required = false) String status,
                                           @RequestParam(required = false) Integer page,
                                           @RequestParam(required = false) Integer size) {
        return directory.accounts(search, status, PageResult.page(page), PageResult.size(size));
    }

    @GetMapping("/accounts/{accountId}")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.account.read')")
    public AccountRow account(@PathVariable UUID accountId) {
        return directory.account(accountId);
    }
}
