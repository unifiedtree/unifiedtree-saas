package com.unifiedtree.saas.marketing;

import com.unifiedtree.saas.marketing.MarketingAccessService.Handoff;
import com.unifiedtree.saas.marketing.MarketingAccessService.WorkspaceChoice;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The person's side of signing in to Marketing Automation (marketing.unifiedtree.com)
 * with their UnifiedTree account. Needs an ACCOUNT token (POST /v1/accounts/auth/login
 * or /refresh) — the same login as everywhere else on UnifiedTree; Marketing has no
 * password of its own.
 *
 * <ol>
 *   <li>{@code GET /v1/sso/marketing/companies} — the workspaces and companies the
 *       person may enter, each marked with whether it has Marketing.</li>
 *   <li>{@code POST /v1/sso/marketing/handoff {tenantId, companyId}} — checks
 *       membership, company access and entitlement now, and returns a single-use
 *       ticket valid for 60 seconds. The browser takes it to Marketing, which redeems
 *       it server-to-server (/v1/internal/marketing/sso/redeem).</li>
 * </ol>
 * The browser proposes the company; the server decides. A company id the person
 * cannot access gets 403, never a ticket.
 */
@RestController
@RequestMapping("/v1/sso/marketing")
public class MarketingSsoController {

    private final MarketingAccessService access;

    public MarketingSsoController(MarketingAccessService access) {
        this.access = access;
    }

    public record HandoffRequest(@NotNull UUID tenantId, @NotNull UUID companyId) {}

    @GetMapping("/companies")
    @PreAuthorize("hasRole('ACCOUNT_USER')")
    public List<WorkspaceChoice> companies(@AuthenticationPrincipal Jwt jwt) {
        return access.choices(UUID.fromString(jwt.getSubject()));
    }

    @PostMapping("/handoff")
    @PreAuthorize("hasRole('ACCOUNT_USER')")
    public Handoff handoff(@Valid @RequestBody HandoffRequest req, @AuthenticationPrincipal Jwt jwt,
                           HttpServletRequest http) {
        return access.mint(UUID.fromString(jwt.getSubject()), req.tenantId(), req.companyId(),
                http.getRemoteAddr(), http.getHeader("User-Agent"));
    }
}
