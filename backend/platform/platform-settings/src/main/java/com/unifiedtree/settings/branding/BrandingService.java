package com.unifiedtree.settings.branding;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.Optional;
import java.util.UUID;

/**
 * Per-workspace branding — logo + favicon + primary colour.
 *
 * <p>The logo is stored in R2 at {@code branding/{tenantId}/logo-{uuid}.{ext}}
 * (new UUID on every upload, so the old CDN cache is naturally busted). The
 * table row keeps both the URL (what the SPA renders) and the R2 key (what
 * we delete on re-upload) so we do not need to reverse-parse the URL later.
 *
 * <p>File limits: 2 MB max, PNG / JPEG / WebP only. Magic-byte sniffing
 * because the client's Content-Type is untrusted. SVG is deliberately not
 * allowed — SVG can carry &lt;script&gt; and &lt;foreignObject&gt; which are
 * XSS vectors when rendered inline.
 */
@Service
public class BrandingService {

    private static final Logger log = LoggerFactory.getLogger(BrandingService.class);
    private static final long MAX_BYTES = 2L * 1024 * 1024;

    private final JdbcTemplate jdbc;
    private final R2Storage r2;

    public BrandingService(JdbcTemplate jdbc, R2Storage r2) {
        this.jdbc = jdbc;
        this.r2 = r2;
    }

    // ------------------------------------------------------------------ read

    public Optional<Branding> get(UUID tenantId) {
        return jdbc.query("""
                SELECT logo_url, logo_r2_key, favicon_url, primary_color
                  FROM platform.tenant_branding WHERE tenant_id = ?
                """,
                rs -> rs.next()
                        ? Optional.of(new Branding(
                            rs.getString("logo_url"),
                            rs.getString("logo_r2_key"),
                            rs.getString("favicon_url"),
                            rs.getString("primary_color")))
                        : Optional.<Branding>empty(),
                tenantId);
    }

    // ------------------------------------------------------------------ write

    /**
     * Replace the workspace's logo. Returns the fresh public/presigned URL.
     *
     * <p>{@code @Transactional} is <b>mandatory</b> — the app's shared
     * {@code TenantAwareDataSource} forces {@code autoCommit=false} on every
     * leased Postgres connection so its {@code SET LOCAL app.tenant_id} lives
     * for a real transaction. Without Spring wrapping this method in a
     * transaction, the INSERT here quietly rolls back when the connection
     * returns to the pool — the R2 upload succeeds, the URL is returned,
     * and the DB row silently doesn't exist. Verified live 2026-08-10.
     */
    @Transactional
    public Branding uploadLogo(UUID tenantId, UUID actorId, MultipartFile file) {
        if (!r2.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Logo storage is not configured on this deployment");
        }
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No file uploaded");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "Logo must be 2 MB or smaller");
        }

        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (java.io.IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot read upload", e);
        }
        Sniffed sniffed = sniff(bytes);
        if (sniffed == null) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "Only PNG, JPEG, and WebP images are allowed");
        }

        // Delete the previous R2 object BEFORE the DB flip so a failed put
        // leaves the old logo intact. Best-effort — a stray old file never
        // reaches the SPA (the URL isn't served) and R2's lifecycle-rule
        // sweep would eventually reap it.
        Optional<Branding> existing = get(tenantId);
        String key = "branding/" + tenantId + "/logo-" + UUID.randomUUID() + "." + sniffed.ext;
        r2.put(key, bytes, sniffed.contentType);
        String url = r2.urlFor(key);

        int updated = jdbc.update("""
                INSERT INTO platform.tenant_branding
                    (tenant_id, logo_url, logo_r2_key, updated_at, updated_by)
                VALUES (?, ?, ?, now(), ?)
                ON CONFLICT (tenant_id) DO UPDATE SET
                    logo_url    = EXCLUDED.logo_url,
                    logo_r2_key = EXCLUDED.logo_r2_key,
                    updated_at  = now(),
                    updated_by  = EXCLUDED.updated_by
                """, tenantId, url, key, actorId);
        if (updated != 1) {
            // Extremely unlikely, but if the DB write silently failed we'd
            // leave R2 holding an orphan. Delete it so we don't accumulate.
            r2.deleteQuietly(key);
            throw new IllegalStateException("Failed to persist branding row for tenant " + tenantId);
        }
        existing.map(Branding::logoR2Key).ifPresent(r2::deleteQuietly);
        log.info("Logo replaced for tenant={} newKey={}", tenantId, key);
        return new Branding(url, key, existing.map(Branding::faviconUrl).orElse(null),
                existing.map(Branding::primaryColor).orElse(null));
    }

    // ------------------------------------------------------------------ util

    private record Sniffed(String contentType, String ext) {}

    /**
     * Read the first 12 bytes and match a magic-byte signature. Anything that
     * doesn't match returns null and the caller rejects.
     * <ul>
     *  <li>PNG:  89 50 4E 47 0D 0A 1A 0A</li>
     *  <li>JPEG: FF D8 FF</li>
     *  <li>WebP: "RIFF" .... "WEBP"</li>
     * </ul>
     */
    private static Sniffed sniff(byte[] b) {
        if (b == null || b.length < 12) return null;
        if (b[0] == (byte) 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47)
            return new Sniffed("image/png", "png");
        if (b[0] == (byte) 0xFF && b[1] == (byte) 0xD8 && b[2] == (byte) 0xFF)
            return new Sniffed("image/jpeg", "jpg");
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
            && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P')
            return new Sniffed("image/webp", "webp");
        return null;
    }

    /** Public projection of a branding row. */
    public record Branding(String logoUrl, String logoR2Key,
                           String faviconUrl, String primaryColor) {}
}
