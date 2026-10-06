package com.hrms.api.workforce.images;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Employee photos, branch logos and agency logos (V143.102, hrms.record_images).
 * One re-encoded image per record (see {@link RecordImage}); each upload gets a
 * new random token and the image is served at {@link #path}. Plain JDBC on the
 * request's transaction, so the tenant GUC (row-level security) applies; the
 * record is looked up first, so an id from another workspace is "not found".
 *
 * <p>An employee photo's address is also written to
 * {@code hrms.employees.profile_photo_url} and to the person's login
 * ({@code auth.user_credentials.avatar_url}): the directory, team lists, the
 * org chart, search and the signed-in header already read those.
 *
 * <p>Until V143.102 is applied every write answers FEATURE_NOT_READY and every
 * read is empty, so nothing that works today changes.
 */
@Service
public class RecordImageService {

    /** Public address prefix (relative to the API root). */
    public static final String PUBLIC_PREFIX = "/v1/public/images/";

    /** What an image belongs to, with the table that record lives in. */
    public enum Kind {
        EMPLOYEE("hrms.employees", "Employee", RecordImage.Shape.PHOTO),
        BRANCH("org.branches", "Branch", RecordImage.Shape.LOGO),
        AGENCY("hrms.contractors", "Agency", RecordImage.Shape.LOGO);

        final String table;
        final String noun;
        public final RecordImage.Shape shape;

        Kind(String table, String noun, RecordImage.Shape shape) {
            this.table = table;
            this.noun = noun;
            this.shape = shape;
        }

        /** "employee" / "branch" / "agency" (case-insensitive); null for anything else. */
        public static Kind parse(String s) {
            if (s == null) return null;
            return switch (s.trim().toLowerCase(java.util.Locale.ROOT)) {
                case "employee" -> EMPLOYEE;
                case "branch" -> BRANCH;
                case "agency", "contractor" -> AGENCY;
                default -> null;
            };
        }
    }

    /** One stored image, for the public read. */
    public record Stored(String contentType, byte[] bytes) {}

    private final JdbcTemplate jdbc;

    public RecordImageService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The address an image is served at. */
    public static String path(UUID tenantId, UUID token) {
        return PUBLIC_PREFIX + tenantId + "/" + token;
    }

    /** Whether V143.102 is applied. */
    public boolean available() {
        Boolean ok = jdbc.queryForObject("SELECT to_regclass('hrms.record_images') IS NOT NULL", Boolean.class);
        return Boolean.TRUE.equals(ok);
    }

    private void requireAvailable() {
        if (!available()) {
            throw new BusinessRuleException("Photos and logos can’t be uploaded yet: this part of the server isn’t switched on", "FEATURE_NOT_READY");
        }
    }

    private static UUID tenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        return t;
    }

    /** 404 unless the record exists in this workspace (row-level security keeps others out). */
    void requireRecord(Kind kind, UUID id) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM " + kind.table + " WHERE id = ?", Integer.class, id);
        if (n == null || n == 0) throw new ResourceNotFoundException(kind.noun + " " + id + " not found");
    }

    /** Checks, re-encodes and stores the image; returns its address. */
    @Transactional
    public String put(Kind kind, UUID recordId, byte[] upload, String actor) {
        requireAvailable();
        requireRecord(kind, recordId);
        RecordImage.Processed img = RecordImage.process(upload, kind.shape);
        UUID tenant = tenant();
        UUID token = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO hrms.record_images (tenant_id, kind, record_id, token, content_type, bytes, width, height, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), ?)
                ON CONFLICT (tenant_id, kind, record_id) DO UPDATE
                   SET token = EXCLUDED.token, content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes,
                       width = EXCLUDED.width, height = EXCLUDED.height, updated_at = now(), updated_by = EXCLUDED.updated_by""",
                tenant, kind.name(), recordId, token, img.contentType(), img.bytes(), img.width(), img.height(), actor);
        String url = path(tenant, token);
        if (kind == Kind.EMPLOYEE) linkEmployee(tenant, recordId, url);
        return url;
    }

    /** Removes the image (nothing to remove is fine). */
    @Transactional
    public void remove(Kind kind, UUID recordId) {
        requireAvailable();
        requireRecord(kind, recordId);
        UUID tenant = tenant();
        jdbc.update("DELETE FROM hrms.record_images WHERE tenant_id = ? AND kind = ? AND record_id = ?", tenant, kind.name(), recordId);
        if (kind == Kind.EMPLOYEE) linkEmployee(tenant, recordId, null);
    }

    /** The photo on the employee record and on their login (null clears both). */
    private void linkEmployee(UUID tenant, UUID employeeId, String url) {
        jdbc.update("UPDATE hrms.employees SET profile_photo_url = ? WHERE id = ?", url, employeeId);
        jdbc.update("UPDATE auth.user_credentials SET avatar_url = ?, updated_at = now() WHERE employee_id = ? AND tenant_id = ?",
                url, employeeId, tenant);
    }

    /** Every image of this kind in the workspace: record id → address. Empty before V143.102. */
    @Transactional(readOnly = true)
    public Map<UUID, String> urls(Kind kind) {
        if (!available()) return Map.of();
        UUID tenant = tenant();
        Map<UUID, String> out = new LinkedHashMap<>();
        jdbc.query("SELECT record_id, token FROM hrms.record_images WHERE tenant_id = ? AND kind = ?",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getObject(1, UUID.class), path(tenant, rs.getObject(2, UUID.class))),
                tenant, kind.name());
        return out;
    }

    /** The public read: the one image with this tenant and token, through the SECURITY DEFINER function. */
    @Transactional(readOnly = true)
    public Optional<Stored> publicImage(UUID tenantId, UUID token) {
        if (!available()) return Optional.empty();
        List<Stored> rows = jdbc.query("SELECT content_type, bytes FROM hrms.public_record_image(?, ?)",
                (rs, i) -> new Stored(rs.getString(1), rs.getBytes(2)), tenantId, token);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }
}
