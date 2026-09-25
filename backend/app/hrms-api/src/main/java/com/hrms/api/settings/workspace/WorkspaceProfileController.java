package com.hrms.api.settings.workspace;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * The workspace's own profile (Settings -> Profile -> Organisation): name,
 * contact email and phone, registered address, GSTIN and PAN. Stored on
 * platform.tenants (not RLS-isolated, so every query names the tenant from the
 * access token; the id never comes from the request).
 *
 * <pre>
 *   GET /v1/workspace/profile   anyone signed in to the workspace
 *   PUT /v1/workspace/profile   workspace.profile.update
 * </pre>
 * A bad field is a 422 whose {@code fields} map says what to fix per field.
 */
@RestController
@RequestMapping("/v1/workspace/profile")
@SecurityRequirement(name = "bearerAuth")
public class WorkspaceProfileController {

    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public WorkspaceProfileController(JdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public record WorkspaceProfile(UUID tenantId, String subdomain, String planType, String displayName,
                                   String contactEmail, String contactPhone, String addressLine1, String addressLine2,
                                   String city, String state, String postalCode, String gstin, String pan,
                                   boolean canEdit) {}

    /** A validation failure that carries the per-field messages. */
    public static class ProfileInvalidException extends HrmsException {
        private final Map<String, String> fields;
        public ProfileInvalidException(Map<String, String> fields) {
            super(fields.values().iterator().next(), HttpStatus.UNPROCESSABLE_ENTITY, "WORKSPACE_PROFILE_INVALID");
            this.fields = fields;
        }
        public Map<String, String> getFields() { return fields; }
    }

    @Operation(summary = "The workspace profile")
    @GetMapping
    @PreAuthorize("hasAnyAuthority('workspace.context.read', 'workspace.profile.update', 'settings.read')")
    @Transactional(readOnly = true)
    public WorkspaceProfile get() {
        return load(tenant());
    }

    @Operation(summary = "Update the workspace profile")
    @PutMapping
    @PreAuthorize("hasAuthority('workspace.profile.update')")
    @Transactional
    public WorkspaceProfile update(@RequestBody WorkspaceProfileRules.Profile body) {
        if (body == null) throw new BusinessRuleException("Nothing to save.", "WORKSPACE_PROFILE_EMPTY");
        UUID tenantId = tenant();
        WorkspaceProfileRules.Profile p = WorkspaceProfileRules.normalize(body);
        Map<String, String> errors = WorkspaceProfileRules.validate(p);
        if (!errors.isEmpty()) throw new ProfileInvalidException(errors);

        WorkspaceProfile before = load(tenantId);
        jdbc.update("""
                UPDATE platform.tenants
                   SET display_name = ?, contact_email = ?, contact_phone = ?,
                       address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?,
                       gstin = ?, pan = ?
                 WHERE id = ?
                """, p.displayName(), p.contactEmail(), p.contactPhone(), p.addressLine1(), p.addressLine2(),
                p.city(), p.state(), p.postalCode(), p.gstin(), p.pan(), tenantId);
        WorkspaceProfile after = load(tenantId);
        List<String> changed = changedFields(before, after);
        if (!changed.isEmpty()) {
            audit.record("settings", "WORKSPACE_PROFILE_UPDATED", "workspace", tenantId,
                    "Workspace profile changed: " + String.join(", ", changed));
        }
        return after;
    }

    /** 422 with the per-field messages, so the page can mark each field. */
    @org.springframework.web.bind.annotation.ExceptionHandler(ProfileInvalidException.class)
    public org.springframework.http.ResponseEntity<Map<String, Object>> invalid(ProfileInvalidException e) {
        return org.springframework.http.ResponseEntity.unprocessableEntity().body(Map.of(
                "status", 422, "errorCode", e.getErrorCode(), "message", e.getMessage(), "fields", e.getFields()));
    }

    private WorkspaceProfile load(UUID tenantId) {
        List<WorkspaceProfile> rows = jdbc.query("""
                SELECT id, subdomain, plan_type, display_name, contact_email, contact_phone,
                       address_line1, address_line2, city, state, postal_code, gstin, pan
                  FROM platform.tenants WHERE id = ?
                """, (rs, n) -> new WorkspaceProfile(rs.getObject("id", UUID.class), rs.getString("subdomain"),
                rs.getString("plan_type"), rs.getString("display_name"), rs.getString("contact_email"),
                rs.getString("contact_phone"), rs.getString("address_line1"), rs.getString("address_line2"),
                rs.getString("city"), rs.getString("state"), rs.getString("postal_code"), rs.getString("gstin"),
                rs.getString("pan"), canEdit()), tenantId);
        if (rows.isEmpty()) throw new HrmsException("Workspace not found.", HttpStatus.NOT_FOUND, "WORKSPACE_NOT_FOUND");
        return rows.get(0);
    }

    private static List<String> changedFields(WorkspaceProfile a, WorkspaceProfile b) {
        List<String> out = new ArrayList<>();
        if (!Objects.equals(a.displayName(), b.displayName())) out.add("name");
        if (!Objects.equals(a.contactEmail(), b.contactEmail())) out.add("contact email");
        if (!Objects.equals(a.contactPhone(), b.contactPhone())) out.add("contact phone");
        if (!Objects.equals(a.addressLine1(), b.addressLine1()) || !Objects.equals(a.addressLine2(), b.addressLine2())
                || !Objects.equals(a.city(), b.city()) || !Objects.equals(a.state(), b.state())
                || !Objects.equals(a.postalCode(), b.postalCode())) out.add("address");
        if (!Objects.equals(a.gstin(), b.gstin())) out.add("GSTIN");
        if (!Objects.equals(a.pan(), b.pan())) out.add("PAN");
        return out;
    }

    private static boolean canEdit() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> "workspace.profile.update".equals(a.getAuthority()));
    }

    private static UUID tenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        return t;
    }
}
