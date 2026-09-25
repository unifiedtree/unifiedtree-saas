package com.unifiedtree.settings.branding;

import com.unifiedtree.settings.branding.BrandingImage.Kind;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Unauthenticated branding reads, for screens shown before sign-in.
 *
 * <ul>
 *   <li>{@code GET /v1/public/workspace-branding?subdomain=acme} (or the
 *       {@code X-Tenant-Subdomain} header / Host): the workspace's display
 *       name, monogram letter and image addresses. Nothing else about the
 *       workspace is returned.</li>
 *   <li>{@code GET /v1/public/workspace-branding/{tenantId}/{logo|mark}?v=…}:
 *       the image itself. The address carries a content hash, so a matching
 *       {@code v} is cached for a year; anything else for five minutes.</li>
 * </ul>
 * Both paths are in the permitAll list of CanonicalProdSecurityConfig.
 */
@RestController
@RequestMapping("/v1/public/workspace-branding")
public class PublicBrandingController {

    private static final Pattern SLUG = Pattern.compile("^[a-z0-9][a-z0-9-]{0,62}$");

    private final BrandingService service;

    public PublicBrandingController(BrandingService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<BrandingService.PublicView> lookup(
            @RequestParam(value = "subdomain", required = false) String subdomainParam,
            @RequestHeader(value = "X-Tenant-Subdomain", required = false) String subdomainHeader,
            @RequestHeader(value = "Host", required = false) String host) {
        String sub = resolve(subdomainParam, subdomainHeader, host);
        if (sub == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not identified");
        BrandingService.PublicView v = service.publicView(sub)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found"));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(60, TimeUnit.SECONDS).cachePublic())
                .body(v);
    }

    @GetMapping("/{tenantId}/{kind}")
    public ResponseEntity<byte[]> image(@PathVariable("tenantId") String tenantIdRaw,
                                        @PathVariable("kind") String kindRaw,
                                        @RequestParam(value = "v", required = false) String v) {
        UUID tenantId;
        try { tenantId = UUID.fromString(tenantIdRaw); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found"); }
        Kind kind = Kind.parse(kindRaw);
        BrandingService.Asset a = service.asset(tenantId, kind)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found"));
        boolean pinned = v != null && v.equals(a.version());
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(a.contentType()))
                .cacheControl(pinned
                        ? CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable()
                        : CacheControl.maxAge(5, TimeUnit.MINUTES).cachePublic())
                .eTag('"' + a.version() + '"')
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; sandbox")
                .header("Cross-Origin-Resource-Policy", "cross-origin")
                .body(a.bytes());
    }

    /** ?subdomain= wins, then the header the web app sends, then the Host's first label. */
    static String resolve(String param, String header, String host) {
        for (String s : new String[]{param, header}) {
            if (s != null && !s.isBlank()) {
                String t = s.trim().toLowerCase(Locale.ROOT);
                return SLUG.matcher(t).matches() ? t : null;
            }
        }
        if (host != null && !host.isBlank()) {
            String h = host.trim().toLowerCase(Locale.ROOT);
            int colon = h.indexOf(':');
            if (colon >= 0) h = h.substring(0, colon);
            int dot = h.indexOf('.');
            if (dot > 0) {
                String first = h.substring(0, dot);
                // api.<domain> / www.<domain> are not workspaces.
                if (!first.equals("api") && !first.equals("www") && SLUG.matcher(first).matches()) return first;
            }
        }
        return null;
    }
}
