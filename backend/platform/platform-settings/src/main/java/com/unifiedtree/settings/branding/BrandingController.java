package com.unifiedtree.settings.branding;

import com.unifiedtree.settings.branding.BrandingImage.Kind;
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

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Per-workspace branding (white label).
 *
 * <ul>
 *   <li>{@code GET    /v1/workspace/branding}: any signed-in member. The
 *       workspace name, its monogram letter and the logo / mark addresses.
 *       The app shell, splash, browser tab and Settings read it.</li>
 *   <li>{@code POST   /v1/workspace/branding/logo} and {@code /mark}:
 *       multipart upload, {@code settings.branding.write}. Re-validated on
 *       the server (see {@link BrandingImage}).</li>
 *   <li>{@code DELETE /v1/workspace/branding/logo} and {@code /mark}:
 *       {@code settings.branding.write}. The app falls back to the other
 *       image, then to the monogram.</li>
 * </ul>
 *
 * <p>The tenant always comes from the JWT, never from the request, so one
 * workspace can never read or change another's branding. The public read
 * for the sign-in page lives in {@link PublicBrandingController}.
 */
@RestController
@RequestMapping("/v1/workspace/branding")
public class BrandingController {

    private static final Logger log = LoggerFactory.getLogger(BrandingController.class);

    private final BrandingService service;

    public BrandingController(BrandingService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public BrandingDto get(@AuthenticationPrincipal Jwt jwt) {
        return BrandingDto.of(service.view(tenantIdOf(jwt)));
    }

    @PostMapping(value = "/{kind}", consumes = "multipart/form-data")
    @PreAuthorize("hasAuthority('settings.branding.write')")
    public ResponseEntity<BrandingDto> upload(@AuthenticationPrincipal Jwt jwt,
                                              @PathVariable("kind") String kind,
                                              @RequestPart("file") MultipartFile file) {
        UUID tenantId = tenantIdOf(jwt);
        UUID actorId = actorIdOf(jwt);
        Kind k = Kind.parse(kind);
        BrandingService.View saved = service.upload(tenantId, actorId, k, file);
        log.info("Branding {} uploaded tenant={} actor={}", k.key(), tenantId, actorId);
        return ResponseEntity.status(HttpStatus.CREATED).body(BrandingDto.of(saved));
    }

    @DeleteMapping("/{kind}")
    @PreAuthorize("hasAuthority('settings.branding.write')")
    public BrandingDto remove(@AuthenticationPrincipal Jwt jwt, @PathVariable("kind") String kind) {
        UUID tenantId = tenantIdOf(jwt);
        UUID actorId = actorIdOf(jwt);
        Kind k = Kind.parse(kind);
        BrandingService.View v = service.remove(tenantId, actorId, k);
        log.info("Branding {} removed tenant={} actor={}", k.key(), tenantId, actorId);
        return BrandingDto.of(v);
    }

    // -- helpers --------------------------------------------------------------

    private static UUID tenantIdOf(Jwt jwt) {
        String s = jwt == null ? null : jwt.getClaimAsString("tenant_id");
        if (s == null || s.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant_id missing");
        }
        return UUID.fromString(s);
    }

    private static UUID actorIdOf(Jwt jwt) {
        try { return UUID.fromString(jwt.getSubject()); }
        catch (Exception e) { return null; }
    }

    /**
     * Wire response. {@code logoUrl} / {@code markUrl} are either absolute
     * (R2) or a path relative to the API root ({@code /v1/public/...}); the
     * web app resolves the latter against its API base. {@code faviconUrl}
     * and {@code primaryColor} are kept for older clients (always null now:
     * the favicon is the mark, and colours are the app's own).
     */
    public record BrandingDto(String workspaceName, String monogram,
                              String logoUrl, String markUrl,
                              Integer logoWidth, Integer logoHeight,
                              Integer markWidth, Integer markHeight,
                              OffsetDateTime updatedAt,
                              String faviconUrl, String primaryColor) {
        static BrandingDto of(BrandingService.View v) {
            return new BrandingDto(v.workspaceName(), v.monogram(), v.logoUrl(), v.markUrl(),
                    v.logoWidth(), v.logoHeight(), v.markWidth(), v.markHeight(), v.updatedAt(),
                    v.markUrl(), null);
        }
    }
}
