package com.hrms.api.images;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * {@code GET /v1/public/images/{tenantId}/{token}}: an employee photo, branch
 * logo or agency logo (V143.102), without sign-in so an {@code <img>} can show
 * it (as the workspace logo, PublicBrandingController). The token is a random
 * UUID that changes on every upload, so the answer is cached for a year; both
 * the tenant and the token must match. In the permitAll list of
 * CanonicalProdSecurityConfig.
 */
@RestController
@RequestMapping("/v1/public/images")
public class PublicRecordImageController {

    private final RecordImageService images;

    public PublicRecordImageController(RecordImageService images) {
        this.images = images;
    }

    @GetMapping("/{tenantId}/{token}")
    public ResponseEntity<byte[]> image(@PathVariable("tenantId") String tenantRaw, @PathVariable("token") String tokenRaw) {
        UUID tenant = uuid(tenantRaw), token = uuid(tokenRaw);
        RecordImageService.Stored img = images.publicImage(tenant, token)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found"));
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(img.contentType()))
                .cacheControl(CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; sandbox")
                .header("Cross-Origin-Resource-Policy", "cross-origin")
                .body(img.bytes());
    }

    private static UUID uuid(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found");
        }
    }
}
