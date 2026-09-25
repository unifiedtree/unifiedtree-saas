package com.hrms.api.document;

import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * The ten default document types (Aadhaar, PAN, Passport, …) for a workspace
 * that has none.
 *
 * <p>V143.7 seeded them only for the tenants that existed when it ran, so every
 * workspace created afterwards had an empty type list: employees could not
 * self-upload (the upload needs a type) and HR saw no types to choose from.
 * V143.13 backfills existing tenants; this seeds any tenant on its first read
 * of the type list, so new workspaces get them whatever path created them.
 *
 * <p>"Has none" means no row at all, active or not: a workspace that switched
 * every type off keeps its choice. Concurrent first reads are safe (ON CONFLICT
 * on the tenant + code unique index). Runs in its own transaction so it commits
 * even when called from a read-only one.
 */
@Service
public class DocumentTypeDefaults {

    private static final Logger log = LoggerFactory.getLogger(DocumentTypeDefaults.class);

    /** code, display name, description, formats, max MB, required, expiry tracked, sort order. Same as V143.7. */
    record Default(String code, String displayName, String description, String allowedFormats,
                   int maxSizeMb, boolean required, boolean expiryTracked, int sortOrder) {}

    static final List<Default> DEFAULTS = List.of(
            new Default("AADHAAR", "Aadhaar Card", "Government-issued Indian ID.", "pdf,jpg,jpeg,png", 5, true, false, 10),
            new Default("PAN", "PAN Card", "Permanent Account Number card (required for payroll).", "pdf,jpg,jpeg,png", 5, true, false, 20),
            new Default("PASSPORT", "Passport", "Only if you have one — expiry is tracked.", "pdf,jpg,jpeg,png", 5, false, true, 30),
            new Default("DRIVING_LICENSE", "Driving License", "Only if you have one — expiry is tracked.", "pdf,jpg,jpeg,png", 5, false, true, 40),
            new Default("VOTER_ID", "Voter ID", "EPIC / Voter ID card.", "pdf,jpg,jpeg,png", 5, false, false, 50),
            new Default("PHOTO", "Passport-size Photograph", "Recent passport-size photo for your profile.", "jpg,jpeg,png", 2, true, false, 60),
            new Default("RESUME", "Resume / CV", "Your latest resume.", "pdf", 5, true, false, 70),
            new Default("EDUCATION_CERT", "Educational Certificate", "10th, 12th, degree or diploma certificates.", "pdf,jpg,jpeg,png", 10, false, false, 80),
            new Default("OFFER_LETTER", "Offer Letter", "Signed offer letter or appointment letter.", "pdf", 5, false, false, 90),
            new Default("OTHER", "Other", "Anything else HR asks you to upload.", "pdf,jpg,jpeg,png", 10, false, false, 100));

    private final JdbcTemplate jdbc;

    public DocumentTypeDefaults(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * True when the current tenant has no document type at all. Runs in the
     * caller's transaction (no annotation), so a normal read costs one cheap query
     * and never opens the second connection {@link #ensureDefaults()} needs.
     */
    public boolean missing() {
        UUID tenant = TenantContext.getTenantId();
        if (tenant == null) return false;
        Boolean any = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM document_mgmt.document_types WHERE tenant_id = ?)", Boolean.class, tenant);
        return !Boolean.TRUE.equals(any);
    }

    /** Seeds the defaults when the current tenant has no document types. Returns how many were inserted. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int ensureDefaults() {
        UUID tenant = TenantContext.getTenantId();
        if (tenant == null) return 0;
        // RLS scopes this to the caller's tenant; the explicit filter keeps it right
        // for a connection that bypasses RLS (superuser in local runs).
        Integer existing = jdbc.queryForObject(
                "SELECT count(*) FROM document_mgmt.document_types WHERE tenant_id = ?", Integer.class, tenant);
        if (existing != null && existing > 0) return 0;
        int inserted = 0;
        for (Default d : DEFAULTS) {
            inserted += jdbc.update("""
                    INSERT INTO document_mgmt.document_types
                        (tenant_id, code, display_name, description, allowed_formats,
                         max_size_mb, required, expiry_tracked, active, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
                    ON CONFLICT (tenant_id, code) DO NOTHING
                    """, tenant, d.code(), d.displayName(), d.description(), d.allowedFormats(),
                    d.maxSizeMb(), d.required(), d.expiryTracked(), d.sortOrder());
        }
        if (inserted > 0) log.info("Seeded {} default document types for tenant {}", inserted, tenant);
        return inserted;
    }
}
