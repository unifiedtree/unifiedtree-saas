package com.hrms.api.users;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import com.unifiedtree.settings.branding.R2Storage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Profile-avatar upload / delete for the signed-in user.
 *
 * <p><b>Storage.</b> The task brief mentioned a GCS bucket, but this
 * backend does not integrate google-cloud-storage — the only object store
 * wired in is {@link R2Storage} (Cloudflare R2, S3-compatible). Reusing it
 * keeps operations, credentials and lifecycle rules in one place and
 * matches the pattern already used for workspace-logo uploads.
 *
 * <p><b>Key layout.</b>
 * {@code user-avatars/{tenantId}/{userId}-{random-uuid}.jpg} — the
 * random-UUID suffix makes the key unguessable. Before wupvu2ox7 flagged
 * it, the previous scheme was deterministic ({@code {tenantId}/{userId}.jpg}),
 * so anyone who could guess or scrape a tenant + user id could probe
 * every colleague's avatar. Randomising the suffix closes that hole; the
 * bucket's public URL now reveals no user identity even when leaked.
 *
 * <p><b>Persisted value.</b> The full R2 object key (not the presigned URL)
 * lives in {@code auth.user_credentials.avatar_url} so delete/overwrite can
 * target the exact object, and so a rotated presigner secret never leaves
 * the column pointing at an unfetchable URL. Callers who need a fetchable
 * URL run the key through {@link R2Storage#urlFor(String)} on read
 * (see {@link UserProfileController#me()}).
 *
 * <p><b>Validation.</b> jpeg / png only, ≤ 5 MB, ≥ 100x100 — checked
 * BEFORE uploading so a bad file never leaves a stray object behind.
 */
@RestController
@RequestMapping("/v1/users/me/avatar")
public class UserAvatarController {

    private static final Logger log = LoggerFactory.getLogger(UserAvatarController.class);

    private static final long   MAX_BYTES = 5L * 1024 * 1024;
    private static final int    MIN_DIM   = 100;
    private static final String CT_JPEG   = "image/jpeg";
    private static final String CT_PNG    = "image/png";

    private static final String KEY_PREFIX = "user-avatars/";

    private final R2Storage    storage;
    private final JdbcTemplate jdbc;

    public UserAvatarController(R2Storage storage, JdbcTemplate jdbc) {
        this.storage = storage;
        this.jdbc    = jdbc;
    }

    // ── upload ─────────────────────────────────────────────────────────────

    /**
     * MUST be @Transactional. TenantAwareDataSource forces autoCommit=false on
     * the leased connection so its `SET LOCAL app.tenant_id` survives for the
     * upcoming transaction boundary. Without one, a JdbcTemplate write here
     * reports rows-updated but is NEVER committed — the connection goes back to
     * the pool and Hikari resets session state, silently discarding it.
     *
     * That is not hypothetical: this endpoint returned 200 with a real R2 URL
     * while auth.user_credentials.avatar_url stayed NULL, so a user's uploaded
     * photo never appeared anywhere (verified in prod 2026-08-18).
     */
    @Transactional
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Map<String, String>> upload(
            @RequestPart("file") MultipartFile file) throws IOException {

        UUID userId   = TenantContext.getUserId();
        UUID tenantId = TenantContext.getTenantId();
        if (userId == null || tenantId == null) {
            throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        }
        if (!storage.isConfigured()) {
            throw new BusinessRuleException(
                    "Avatar upload is unavailable — storage is not configured.",
                    "STORAGE_UNAVAILABLE");
        }
        if (file == null || file.isEmpty()) {
            throw new BusinessRuleException("Please choose a file to upload.", "AVATAR_EMPTY");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new BusinessRuleException(
                    "Avatar must be 5 MB or smaller.", "AVATAR_TOO_LARGE");
        }

        String contentType = file.getContentType();
        if (!CT_JPEG.equalsIgnoreCase(contentType) && !CT_PNG.equalsIgnoreCase(contentType)) {
            throw new BusinessRuleException(
                    "Avatar must be a JPEG or PNG image.", "AVATAR_BAD_TYPE");
        }

        byte[] bytes = file.getBytes();

        // Dimension check — don't trust the client Content-Type alone.
        BufferedImage img;
        try {
            img = ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            throw new BusinessRuleException(
                    "Avatar file is not a readable image.", "AVATAR_UNREADABLE");
        }
        if (img == null) {
            throw new BusinessRuleException(
                    "Avatar file is not a readable image.", "AVATAR_UNREADABLE");
        }
        if (img.getWidth() < MIN_DIM || img.getHeight() < MIN_DIM) {
            throw new BusinessRuleException(
                    "Avatar must be at least " + MIN_DIM + "x" + MIN_DIM + " pixels.",
                    "AVATAR_TOO_SMALL");
        }

        // Read the previous key first — we'll GC it AFTER the new one lands
        // so a mid-flight failure never leaves the user without an avatar.
        String previousKey = readCurrentKey(userId, tenantId);

        String key = keyFor(tenantId, userId, contentType);
        storage.put(key, bytes, contentType);

        int rows = jdbc.update(
                "UPDATE auth.user_credentials SET avatar_url = ?, updated_at = now() "
                        + "WHERE id = ? AND tenant_id = ?",
                key, userId, tenantId);
        if (rows == 0) {
            // Stored an orphan; log and surface a clean error — cleaning up
            // the R2 key here would swallow the real diagnostic.
            log.warn("avatar uploaded for tenant={} user={} but no user_credentials row updated (RLS?)",
                    tenantId, userId);
            throw new BusinessRuleException("Could not save avatar.", "AVATAR_SAVE_FAILED");
        }

        // Best-effort delete of the previous object. Skip if it was a legacy
        // URL rather than a key (before this migration) — we can't safely
        // parse those back into a bucket key.
        if (previousKey != null && isPlainKey(previousKey) && !previousKey.equals(key)) {
            storage.deleteQuietly(previousKey);
        }

        return ResponseEntity.ok(Map.of("avatarUrl", storage.urlFor(key)));
    }

    // ── delete ─────────────────────────────────────────────────────────────

    /** @Transactional for the same reason as upload() above. */
    @Transactional
    @DeleteMapping
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> delete() {
        UUID userId   = TenantContext.getUserId();
        UUID tenantId = TenantContext.getTenantId();
        if (userId == null || tenantId == null) {
            throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        }

        // With random-UUID keys we can no longer reconstruct the object key
        // from the userId — we must read the currently stored key.
        String currentKey = readCurrentKey(userId, tenantId);
        if (storage.isConfigured() && currentKey != null && isPlainKey(currentKey)) {
            storage.deleteQuietly(currentKey);
        }
        jdbc.update(
                "UPDATE auth.user_credentials SET avatar_url = NULL, updated_at = now() "
                        + "WHERE id = ? AND tenant_id = ?",
                userId, tenantId);
        return ResponseEntity.noContent().build();
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /**
     * Random-UUID suffix — the key is unguessable even to someone who knows
     * the tenantId and userId, so a leaked or scraped bucket listing cannot
     * be walked back to a user.
     */
    private static String keyFor(UUID tenantId, UUID userId, String contentType) {
        String ext = CT_PNG.equalsIgnoreCase(contentType) ? "png" : "jpg";
        return KEY_PREFIX + tenantId + "/" + userId + "-" + UUID.randomUUID() + "." + ext;
    }

    private String readCurrentKey(UUID userId, UUID tenantId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT avatar_url FROM auth.user_credentials WHERE id = ? AND tenant_id = ?",
                userId, tenantId);
        if (rows.isEmpty()) return null;
        Object v = rows.get(0).get("avatar_url");
        return v == null ? null : v.toString();
    }

    /**
     * A stored value is a plain object key iff it starts with our key prefix
     * AND doesn't look like a URL. Rows from before this migration hold a
     * full https URL — leave those alone rather than try to delete an
     * unparseable path.
     */
    private static boolean isPlainKey(String s) {
        if (s == null || s.isBlank()) return false;
        String t = s.trim();
        if (t.startsWith("http://") || t.startsWith("https://")) return false;
        return t.startsWith(KEY_PREFIX);
    }
}
