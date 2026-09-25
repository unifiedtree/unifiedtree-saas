package com.unifiedtree.settings.branding;

import com.unifiedtree.settings.branding.BrandingImage.Kind;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Per-workspace branding: a wide logo and a square mark, both optional.
 *
 * <p>White-label rule: a customer never sees the vendor's name or logo inside
 * their workspace. With no image uploaded, the web app draws a monogram (the
 * first letter of the workspace name) in the same slot.
 *
 * <p>Storage. Each upload is re-validated ({@link BrandingImage}) and then:
 * <ul>
 *   <li>its bytes are kept on the {@code platform.tenant_branding} row, which
 *       is what the stable public address
 *       {@code /v1/public/workspace-branding/{tenantId}/{kind}?v=<hash>} and
 *       the PDF headers read. That address never expires, so the sign-in
 *       page, the browser tab icon and emails keep working;</li>
 *   <li>it is also written to R2 through the existing branding flow when R2
 *       is configured (same key scheme as before). A failed R2 write is
 *       logged and does not fail the upload: the database copy is the one
 *       that is served.</li>
 * </ul>
 * Rows written before this change have no bytes, only an R2 key; for those
 * the URL is re-signed on every read so an expired presigned link is never
 * handed out, and the bytes are fetched from R2 for PDFs.
 */
@Service
public class BrandingService {

    private static final Logger log = LoggerFactory.getLogger(BrandingService.class);

    /** Public path (relative to the API root) that serves a stored image. */
    public static String assetPath(UUID tenantId, Kind kind, String version) {
        return "/v1/public/workspace-branding/" + tenantId + "/" + kind.key()
                + (version == null ? "" : "?v=" + version);
    }

    private final JdbcTemplate jdbc;
    private final R2Storage r2;

    public BrandingService(JdbcTemplate jdbc, R2Storage r2) {
        this.jdbc = jdbc;
        this.r2 = r2;
    }

    // ------------------------------------------------------------------ read

    /** Everything the workspace shows about itself: name, monogram and image addresses. */
    @Transactional(readOnly = true)
    public View view(UUID tenantId) {
        String name = jdbc.query("SELECT display_name FROM platform.tenants WHERE id = ?",
                rs -> rs.next() ? rs.getString(1) : null, tenantId);
        return jdbc.query("""
                SELECT logo_url, logo_r2_key, logo_version, logo_width, logo_height, logo_bytes IS NOT NULL AS has_logo,
                       mark_url, mark_r2_key, mark_version, mark_width, mark_height, mark_bytes IS NOT NULL AS has_mark,
                       updated_at
                  FROM platform.tenant_branding WHERE tenant_id = ?
                """,
                rs -> {
                    if (!rs.next()) return new View(name, BrandingImage.monogram(name), null, null, null, null, null, null, null);
                    String logo = displayUrl(tenantId, Kind.LOGO, rs.getBoolean("has_logo"), rs.getString("logo_version"),
                            rs.getString("logo_r2_key"), rs.getString("logo_url"));
                    String mark = displayUrl(tenantId, Kind.MARK, rs.getBoolean("has_mark"), rs.getString("mark_version"),
                            rs.getString("mark_r2_key"), rs.getString("mark_url"));
                    return new View(name, BrandingImage.monogram(name), logo, mark,
                            intOrNull(rs, "logo_width"), intOrNull(rs, "logo_height"),
                            intOrNull(rs, "mark_width"), intOrNull(rs, "mark_height"),
                            rs.getObject("updated_at", OffsetDateTime.class));
                }, tenantId);
    }

    /**
     * Public lookup by subdomain for the sign-in page: the workspace name and
     * its image addresses, nothing else. Empty when no such workspace.
     */
    @Transactional(readOnly = true)
    public Optional<PublicView> publicView(String subdomain) {
        if (subdomain == null || subdomain.isBlank()) return Optional.empty();
        UUID tenantId = jdbc.query("SELECT id FROM platform.tenants WHERE subdomain = ?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                subdomain.trim().toLowerCase(Locale.ROOT));
        if (tenantId == null) return Optional.empty();
        View v = view(tenantId);
        return Optional.of(new PublicView(v.workspaceName(), v.monogram(), v.logoUrl(), v.markUrl()));
    }

    /**
     * The stored bytes of one image, or empty when none. Reads the database
     * copy; for rows written before V143.15 (R2 only) it falls back to R2.
     */
    @Transactional(readOnly = true)
    public Optional<Asset> asset(UUID tenantId, Kind kind) {
        String p = kind.key();
        return jdbc.query(
                "SELECT " + p + "_bytes AS bytes, " + p + "_content_type AS ct, " + p + "_version AS ver, "
                        + p + "_r2_key AS r2key FROM platform.tenant_branding WHERE tenant_id = ?",
                rs -> {
                    if (!rs.next()) return Optional.<Asset>empty();
                    byte[] bytes = rs.getBytes("bytes");
                    if (bytes != null && bytes.length > 0) {
                        return Optional.of(new Asset(bytes, rs.getString("ct"), rs.getString("ver")));
                    }
                    String key = rs.getString("r2key");
                    if (key != null && r2.isConfigured()) {
                        try {
                            byte[] fromR2 = r2.read(key);
                            String type = BrandingImage.sniff(fromR2);
                            if (type != null) return Optional.of(new Asset(fromR2, type, sha(fromR2)));
                        } catch (Exception e) {
                            log.warn("Branding {} for tenant {} could not be read from R2: {}", p, tenantId, e.getMessage());
                        }
                    }
                    return Optional.<Asset>empty();
                }, tenantId);
    }

    /**
     * A {@code data:} URI for embedding in a PDF: the wide logo, else the
     * square mark. PNG and JPEG only (the PDF renderer cannot draw WebP).
     */
    public Optional<String> pdfImageDataUri(UUID tenantId) {
        for (Kind k : new Kind[]{Kind.LOGO, Kind.MARK}) {
            Optional<Asset> a = asset(tenantId, k);
            if (a.isPresent() && ("image/png".equals(a.get().contentType()) || "image/jpeg".equals(a.get().contentType()))) {
                return Optional.of("data:" + a.get().contentType() + ";base64,"
                        + Base64.getEncoder().encodeToString(a.get().bytes()));
            }
        }
        return Optional.empty();
    }

    // ------------------------------------------------------------------ write

    /**
     * Replace one image. {@code @Transactional} is mandatory: the shared
     * TenantAwareDataSource leases connections with autoCommit=false, so a
     * write outside a transaction silently rolls back (verified 2026-08-10).
     */
    @Transactional
    public View upload(UUID tenantId, UUID actorId, Kind kind, MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No file uploaded");
        }
        if (file.getSize() > BrandingImage.MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "The image must be 2 MB or smaller");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (java.io.IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot read upload", e);
        }
        return store(tenantId, actorId, kind, bytes);
    }

    /** Validate and persist raw bytes (the multipart path and tests share this). */
    @Transactional
    public View store(UUID tenantId, UUID actorId, Kind kind, byte[] bytes) {
        BrandingImage.Checked img = BrandingImage.check(bytes, kind);
        String version = sha(bytes);
        String p = kind.key();

        // Best-effort R2 copy through the existing key scheme. The database
        // copy is what gets served, so an R2 outage never blocks a logo change.
        String r2Key = null;
        String r2Url = null;
        if (r2.isConfigured()) {
            String key = "branding/" + tenantId + "/" + p + "-" + UUID.randomUUID() + "." + img.ext();
            try {
                r2.put(key, bytes, img.contentType());
                r2Key = key;
                r2Url = r2.urlFor(key);
            } catch (Exception e) {
                log.warn("R2 copy of branding {} for tenant {} failed, keeping the database copy only: {}",
                        p, tenantId, e.getMessage());
            }
        }
        String oldKey = jdbc.query("SELECT " + p + "_r2_key FROM platform.tenant_branding WHERE tenant_id = ?",
                rs -> rs.next() ? rs.getString(1) : null, tenantId);

        String url = assetPath(tenantId, kind, version);
        int updated = jdbc.update(
                "INSERT INTO platform.tenant_branding (tenant_id, " + p + "_url, " + p + "_r2_key, " + p + "_bytes, "
                        + p + "_content_type, " + p + "_width, " + p + "_height, " + p + "_version, updated_at, updated_by) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), ?) "
                        + "ON CONFLICT (tenant_id) DO UPDATE SET "
                        + p + "_url = EXCLUDED." + p + "_url, "
                        + p + "_r2_key = EXCLUDED." + p + "_r2_key, "
                        + p + "_bytes = EXCLUDED." + p + "_bytes, "
                        + p + "_content_type = EXCLUDED." + p + "_content_type, "
                        + p + "_width = EXCLUDED." + p + "_width, "
                        + p + "_height = EXCLUDED." + p + "_height, "
                        + p + "_version = EXCLUDED." + p + "_version, "
                        + "updated_at = now(), updated_by = EXCLUDED.updated_by",
                tenantId, url, r2Key, bytes, img.contentType(), img.width(), img.height(), version, actorId);
        if (updated != 1) {
            if (r2Key != null) r2.deleteQuietly(r2Key);
            throw new IllegalStateException("Failed to persist branding row for tenant " + tenantId);
        }
        if (oldKey != null && !oldKey.equals(r2Key)) r2.deleteQuietly(oldKey);
        log.info("Branding {} replaced for tenant={} {}x{} {} r2={}", p, tenantId, img.width(), img.height(),
                img.contentType(), r2Url != null);
        return view(tenantId);
    }

    /** Remove one image. The app then shows the other image, or the monogram. */
    @Transactional
    public View remove(UUID tenantId, UUID actorId, Kind kind) {
        String p = kind.key();
        String oldKey = jdbc.query("SELECT " + p + "_r2_key FROM platform.tenant_branding WHERE tenant_id = ?",
                rs -> rs.next() ? rs.getString(1) : null, tenantId);
        jdbc.update("UPDATE platform.tenant_branding SET "
                        + p + "_url = NULL, " + p + "_r2_key = NULL, " + p + "_bytes = NULL, "
                        + p + "_content_type = NULL, " + p + "_width = NULL, " + p + "_height = NULL, "
                        + p + "_version = NULL, updated_at = now(), updated_by = ? WHERE tenant_id = ?",
                actorId, tenantId);
        if (oldKey != null) r2.deleteQuietly(oldKey);
        log.info("Branding {} removed for tenant={} by {}", p, tenantId, actorId);
        return view(tenantId);
    }

    // ------------------------------------------------------------------ util

    private String displayUrl(UUID tenantId, Kind kind, boolean hasBytes, String version, String r2Key, String stored) {
        if (hasBytes) return assetPath(tenantId, kind, version);
        if (r2Key != null && r2.isConfigured()) {
            try { return r2.urlFor(r2Key); } catch (Exception e) { log.warn("R2 re-sign failed: {}", e.getMessage()); }
        }
        // A pre-R2 or externally set address: pass it through as stored.
        return stored != null && stored.startsWith("https://") ? stored : null;
    }

    private static Integer intOrNull(java.sql.ResultSet rs, String col) throws java.sql.SQLException {
        int v = rs.getInt(col);
        return rs.wasNull() ? null : v;
    }

    static String sha(byte[] bytes) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(bytes);
            return HexFormat.of().formatHex(d, 0, 8);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** What a signed-in member sees (and Settings edits). */
    public record View(String workspaceName, String monogram, String logoUrl, String markUrl,
                       Integer logoWidth, Integer logoHeight, Integer markWidth, Integer markHeight,
                       OffsetDateTime updatedAt) {}

    /** What the public sign-in lookup returns: name and images only. */
    public record PublicView(String workspaceName, String monogram, String logoUrl, String markUrl) {}

    /** One stored image. */
    public record Asset(byte[] bytes, String contentType, String version) {}
}
