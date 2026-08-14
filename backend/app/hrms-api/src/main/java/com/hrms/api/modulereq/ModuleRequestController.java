package com.hrms.api.modulereq;

import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Authenticated endpoint a workspace admin hits to ask UnifiedTree to ADD
 * one or more modules to their workspace. We do NOT activate anything here —
 * module enablement stays a manual platform-admin action. We just notify
 * UnifiedTree by email (and best-effort record REQUESTED rows if the tenant
 * is resolvable by subdomain).
 *
 * <p><b>Bundle B4 (D4)</b> — this used to be mounted under {@code /v1/public}
 * with {@code permitAll}. Anonymous callers could POST any subdomain +
 * arbitrary module list, spam our ops inbox, and stuff REQUESTED rows into
 * every tenant's module list — "tenant poisoning". Any signed-in workspace
 * user can still request an add; the anonymous surface is closed. Also
 * rate-limited per email + per ip via {@link PublicEndpointRateLimiter} as
 * defence-in-depth against a compromised account.
 */
@RestController
@RequestMapping("/v1/public")
public class ModuleRequestController {

    private final ModuleRequestService service;
    private final PublicEndpointRateLimiter rateLimiter;

    public ModuleRequestController(ModuleRequestService service,
                                   PublicEndpointRateLimiter rateLimiter) {
        this.service = service;
        this.rateLimiter = rateLimiter;
    }

    public record ModuleRequest(
            @NotBlank String subdomain,
            @NotBlank @Email String adminEmail,
            String adminName,
            @NotEmpty List<String> modules) {}

    /**
     * URL kept at {@code /v1/public/module-request} to preserve the SPA's
     * existing call site. Auth is enforced two ways:
     * <ul>
     *   <li>{@link CanonicalProdSecurityConfig} — this path is REMOVED from
     *       the permitAll list, so Spring Security's catch-all
     *       {@code anyRequest.authenticated()} rejects anonymous callers with
     *       401 before this method runs.</li>
     *   <li>{@code @PreAuthorize("isAuthenticated()")} — method-level belt +
     *       braces in case the security config is misconfigured (permit
     *       creep on the deny-list side is a common accident).</li>
     * </ul>
     */
    @PostMapping("/module-request")
    @PreAuthorize("isAuthenticated()")
    public Map<String, String> requestModules(@Valid @RequestBody ModuleRequest req,
                                              @AuthenticationPrincipal Jwt jwt,
                                              HttpServletRequest http) {
        rateLimiter.check("module-request", clientIp(http), req.adminEmail());
        service.handle(req);
        return Map.of("status", "ok");
    }

    /**
     * Best-effort client-IP resolution. Prefers the leftmost address in
     * {@code X-Forwarded-For} (Cloud Run injects it), else the servlet's
     * {@code getRemoteAddr()}. Returns null on total failure so the limiter
     * simply skips the IP key rather than erroring out the request.
     */
    private static String clientIp(HttpServletRequest req) {
        if (req == null) return null;
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            String first = (comma > 0 ? xff.substring(0, comma) : xff).trim();
            if (!first.isEmpty()) return first;
        }
        return req.getRemoteAddr();
    }
}
