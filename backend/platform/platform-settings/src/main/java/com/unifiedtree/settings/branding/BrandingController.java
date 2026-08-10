package com.unifiedtree.settings.branding;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Per-workspace branding (logo upload today).
 *
 * <p>Two surfaces:
 * <ul>
 *   <li>{@code GET  /v1/workspace/branding} — authenticated. Any workspace
 *       member gets the current logo URL. Used by the platform SPA shell
 *       and Settings page.</li>
 *   <li>{@code POST /v1/workspace/branding/logo} — admin-only. Multipart
 *       upload. Replaces the current logo atomically.</li>
 * </ul>
 *
 * <p>A public read for the login screen ({@code GET /v1/public/workspace-branding})
 * is served by {@code PublicSaasController} — it needs no auth so the login
 * page can render the tenant's logo before the user has a session.
 */
@RestController
@RequestMapping("/v1/workspace/branding")
public class BrandingController {

    private static final Logger log = LoggerFactory.getLogger(BrandingController.class);

    /** Admin-only roles — same as WorkspacePlanController.requireAdmin. */
    private static final java.util.Set<String> BILLING_ROLES =
            java.util.Set.of("SUPER_ADMIN", "OWNER", "COMPANY_ADMIN");

    private final BrandingService service;

    public BrandingController(BrandingService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public BrandingDto get(@AuthenticationPrincipal Jwt jwt) {
        UUID tenantId = tenantIdOf(jwt);
        Optional<BrandingService.Branding> b = service.get(tenantId);
        return b.map(x -> new BrandingDto(x.logoUrl(), x.faviconUrl(), x.primaryColor()))
                .orElse(new BrandingDto(null, null, null));
    }

    @PostMapping(value = "/logo", consumes = "multipart/form-data")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<BrandingDto> uploadLogo(@AuthenticationPrincipal Jwt jwt,
                                                  @RequestPart("file") MultipartFile file) {
        // Same permission model as billing (WorkspacePlanController) — HR
        // managers can approve leaves but should not silently repaint the
        // workspace with a new logo the OWNER never saw.
        requireAdmin(jwt);
        UUID tenantId = tenantIdOf(jwt);
        UUID actorId  = actorIdOf(jwt);
        BrandingService.Branding saved = service.uploadLogo(tenantId, actorId, file);
        log.info("Branding logo uploaded tenant={} actor={}", tenantId, actorId);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new BrandingDto(saved.logoUrl(), saved.faviconUrl(), saved.primaryColor()));
    }

    // -- helpers --------------------------------------------------------------

    private static UUID tenantIdOf(Jwt jwt) {
        String s = jwt.getClaimAsString("tenant_id");
        if (s == null || s.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant_id missing");
        }
        return UUID.fromString(s);
    }

    private static UUID actorIdOf(Jwt jwt) {
        try { return UUID.fromString(jwt.getSubject()); }
        catch (Exception e) { return null; }
    }

    private static void requireAdmin(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        if (roles == null) roles = List.of();
        boolean ok = roles.stream().anyMatch(BILLING_ROLES::contains);
        if (!ok) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only workspace admins can change branding");
        }
    }

    /** Wire response — three fields the SPA reads. */
    public record BrandingDto(String logoUrl, String faviconUrl, String primaryColor) {}
}
