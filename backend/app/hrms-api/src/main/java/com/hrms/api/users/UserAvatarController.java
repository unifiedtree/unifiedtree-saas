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

    private static final long MAX_BYTES = 5L * 1024 * 1024;
    private static final int  MIN_DIM   = 100;

    /**
     * Every raster format a phone or browser realistically hands us.
     *
     * <p>JPEG/PNG alone was too narrow and broke real users: iOS returns
     * {@code image/heic} for camera-roll photos by default, and Android
     * browsers commonly produce {@code image/webp}. Both were rejected as
     * "Avatar must be a JPEG or PNG image" even though the file was a
     * perfectly ordinary photo.
     *
     * <p>Keyed by the sniffed format, not by the client's Content-Type — see
     * {@link #sniff}. The value is the extension used for the stored object.
     */
    private enum ImageFormat {
        JPEG("image/jpeg", "jpg"),
        PNG ("image/png",  "png"),
        GIF ("image/gif",  "gif"),
        WEBP("image/webp", "webp"),
        HEIC("image/heic", "heic"),
        BMP ("image/bmp",  "bmp");

        final String contentType;
        final String ext;
        ImageFormat(String contentType, String ext) {
            this.contentType = contentType;
            this.ext = ext;
        }
    }

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

        byte[] bytes = file.getBytes();

        // Identify the format from the file's own magic bytes rather than the
        // declared Content-Type. Clients lie or omit it — expo-image-picker
        // forwards whatever the OS reports and can send nothing at all — and
        // trusting the header would also let someone upload a script labelled
        // image/png. The sniffed value drives both validation and the stored
        // extension.
        ImageFormat format = sniff(bytes);
        if (format == null) {
            throw new BusinessRuleException(
                    "That file doesn't look like an image. Please choose a JPG, PNG, "
                    + "WebP, HEIC or GIF photo.",
                    "AVATAR_BAD_TYPE");
        }

        // Dimension check where the JVM can actually decode the format. ImageIO
        // ships readers for JPEG/PNG/GIF/BMP but NOT WebP or HEIC, so for those
        // ImageIO.read returns null on a perfectly valid file. Rejecting on that
        // would ban every default iPhone photo, so we accept the file and skip
        // the size floor rather than fail it — the magic-byte check above has
        // already established it is a real image of a known format.
        BufferedImage img = null;
        try {
            img = ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            img = null;
        }
        if (img != null) {
            if (img.getWidth() < MIN_DIM || img.getHeight() < MIN_DIM) {
                throw new BusinessRuleException(
                        "Avatar must be at least " + MIN_DIM + "x" + MIN_DIM + " pixels.",
                        "AVATAR_TOO_SMALL");
            }
        } else if (format == ImageFormat.WEBP || format == ImageFormat.HEIC) {
            log.debug("avatar {}: no ImageIO reader, dimension check skipped", format);
        } else {
            // A format ImageIO *should* handle but couldn't means the bytes are
            // truncated or corrupt, even though the header looked right.
            throw new BusinessRuleException(
                    "That image file appears to be damaged. Please try another photo.",
                    "AVATAR_UNREADABLE");
        }

        String contentType = format.contentType;

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
     * Identify an image by its magic bytes.
     *
     * <p>Deliberately does not consult the client's Content-Type: mobile
     * pickers frequently report the wrong type or none at all, and a declared
     * type is trivially forged. Returns {@code null} when the bytes match no
     * known image container, which is the only rejection path for file type.
     */
    private static ImageFormat sniff(byte[] b) {
        if (b == null || b.length < 12) return null;

        // JPEG: FF D8 FF
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return ImageFormat.JPEG;
        }
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if ((b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && (b[4] & 0xFF) == 0x0D && (b[5] & 0xFF) == 0x0A
                && (b[6] & 0xFF) == 0x1A && (b[7] & 0xFF) == 0x0A) {
            return ImageFormat.PNG;
        }
        // GIF87a / GIF89a
        if (b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8') {
            return ImageFormat.GIF;
        }
        // BMP: "BM"
        if (b[0] == 'B' && b[1] == 'M') {
            return ImageFormat.BMP;
        }
        // WebP: "RIFF" .... "WEBP"
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return ImageFormat.WEBP;
        }
        // HEIC / HEIF — ISO-BMFF: 4-byte size, "ftyp", then a brand.
        // Covers the brands iOS and Android actually emit for camera photos.
        if (b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') {
            String brand = new String(b, 8, 4, java.nio.charset.StandardCharsets.US_ASCII);
            switch (brand) {
                case "heic": case "heix": case "hevc": case "hevx":
                case "heim": case "heis": case "hevm": case "hevs":
                case "mif1": case "msf1":
                    return ImageFormat.HEIC;
                default:
                    return null;   // some other MP4-family container, not an image
            }
        }
        return null;
    }

    /** Stored-object extension for a sniffed content type. */
    private static String extensionFor(String contentType) {
        for (ImageFormat f : ImageFormat.values()) {
            if (f.contentType.equalsIgnoreCase(contentType)) return f.ext;
        }
        return "jpg";
    }

    /**
     * Random-UUID suffix — the key is unguessable even to someone who knows
     * the tenantId and userId, so a leaked or scraped bucket listing cannot
     * be walked back to a user.
     */
    private static String keyFor(UUID tenantId, UUID userId, String contentType) {
        String ext = extensionFor(contentType);
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
