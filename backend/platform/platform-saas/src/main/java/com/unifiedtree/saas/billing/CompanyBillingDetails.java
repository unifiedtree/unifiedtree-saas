package com.unifiedtree.saas.billing;

import com.unifiedtree.saas.admin.support.TenantScopedReader;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A company's billing details, from ONE place for every reader (the invoice snapshot and the
 * "Billing by company" breakdown), so the two never show different details for the same company.
 *
 * <p>Per field, first filled wins:
 * <ul>
 *   <li>Legal name, GSTIN, PAN: {@code org.companies} (HRMS owns them; the billing profile does not
 *       copy them). A GSTIN is kept only when it is well formed ({@link Gst#GSTIN}); a malformed one is
 *       reported in {@code gstinProblem} and never used for the state code.</li>
 *   <li>Billing email, phone: the company's billing profile ({@code platform.company_billing_profiles}),
 *       else the workspace's contact email / phone.</li>
 *   <li>Address: the profile's address override, else the company's headquarters branch
 *       ({@code org.branches.is_headquarters}, else its first branch).</li>
 *   <li>State code (GST place of supply): a valid GSTIN's first two digits (a registered buyer's place
 *       of supply is its registration), else the profile's state code, else the address's state.</li>
 * </ul>
 * {@code org.companies} and {@code org.branches} are FORCE RLS, so they are read inside the workspace
 * ({@link TenantScopedReader}, JDBC only). {@code platform.*} has no RLS.
 */
@Component
public class CompanyBillingDetails {

    public record Details(UUID tenantId, UUID companyId, String name, String legalName, String gstin,
                          String gstinProblem, String pan, String email, String phone, String address,
                          String stateCode, String stateCodeFrom) {

        public boolean registered() {
            return gstin != null;
        }
    }

    private final JdbcTemplate jdbc;
    private final TenantScopedReader scoped;

    public CompanyBillingDetails(JdbcTemplate jdbc, TenantScopedReader scoped) {
        this.jdbc = jdbc;
        this.scoped = scoped;
    }

    /** One company of a workspace, or null when the company is not in that workspace. */
    public Details company(UUID tenantId, UUID companyId) {
        return resolve(tenantId, companyId).get(companyId);
    }

    /** Every company of a workspace, by name. */
    public Map<UUID, Details> companies(UUID tenantId) {
        return resolve(tenantId, null);
    }

    /** The buyer of a workspace-level charge (no company): the workspace's own sign-up details. */
    public Details workspace(UUID tenantId) {
        Map<String, Object> t = jdbc.queryForMap("""
                SELECT display_name, gstin, pan, address_line1, address_line2, city, state, postal_code,
                       contact_email, contact_phone
                  FROM platform.tenants WHERE id = ?
                """, tenantId);
        Gstin g = gstin(str(t.get("gstin")));
        String fromAddress = Gst.stateCode(str(t.get("state")));
        return new Details(tenantId, null, str(t.get("display_name")), str(t.get("display_name")), g.valid(),
                g.problem(), Gst.normalise(str(t.get("pan"))), str(t.get("contact_email")), str(t.get("contact_phone")),
                join(t.get("address_line1"), t.get("address_line2"), t.get("city"), t.get("state"), t.get("postal_code")),
                g.state() != null ? g.state() : fromAddress,
                g.state() != null ? "GSTIN" : fromAddress != null ? "ADDRESS" : null);
    }

    private Map<UUID, Details> resolve(UUID tenantId, UUID onlyCompany) {
        Object[] args = onlyCompany == null ? new Object[] {tenantId} : new Object[] {tenantId, onlyCompany};
        List<Map<String, Object>> companies = scoped.read(tenantId, () -> jdbc.queryForList("""
                SELECT c.id, c.name, c.legal_name, c.gstin, c.pan_number,
                       hq.address_line, hq.city, hq.state, hq.pincode
                  FROM org.companies c
                  LEFT JOIN LATERAL (
                        SELECT b.address_line, b.city, b.state, b.pincode
                          FROM org.branches b
                         WHERE b.company_id = c.id
                         ORDER BY b.is_headquarters DESC, b.created_at
                         LIMIT 1) hq ON TRUE
                 WHERE c.tenant_id = ?""" + (onlyCompany == null ? "" : " AND c.id = ?") + " ORDER BY c.name", args));
        Map<UUID, Map<String, Object>> profiles = new LinkedHashMap<>();
        for (Map<String, Object> p : jdbc.queryForList("""
                SELECT company_id, billing_email, billing_phone, state_code, address_line1, address_line2, city,
                       state, postal_code
                  FROM platform.company_billing_profiles
                 WHERE tenant_id = ?""" + (onlyCompany == null ? "" : " AND company_id = ?"), args)) {
            profiles.put((UUID) p.get("company_id"), p);
        }
        Map<String, Object> ws = jdbc.queryForList(
                "SELECT contact_email, contact_phone FROM platform.tenants WHERE id = ?", tenantId)
                .stream().findFirst().orElse(Map.of());

        Map<UUID, Details> out = new LinkedHashMap<>();
        for (Map<String, Object> c : companies) {
            UUID id = (UUID) c.get("id");
            Map<String, Object> p = profiles.getOrDefault(id, Map.of());
            Gstin g = gstin(str(c.get("gstin")));
            boolean overrideAddress = !blank(p.get("address_line1")) || !blank(p.get("city"))
                    || !blank(p.get("postal_code"));
            String address = overrideAddress
                    ? join(p.get("address_line1"), p.get("address_line2"), p.get("city"), p.get("state"), p.get("postal_code"))
                    : join(c.get("address_line"), c.get("city"), c.get("state"), c.get("pincode"));
            String addressState = Gst.stateCode(str(overrideAddress ? p.get("state") : c.get("state")));
            String profileState = Gst.knownStateCode(str(p.get("state_code"))) ? str(p.get("state_code")) : null;
            String state = g.state() != null ? g.state() : profileState != null ? profileState : addressState;
            String from = g.state() != null ? "GSTIN" : profileState != null ? "BILLING_PROFILE"
                    : addressState != null ? (overrideAddress ? "BILLING_PROFILE_ADDRESS" : "HQ_BRANCH") : null;
            out.put(id, new Details(tenantId, id, str(c.get("name")),
                    blank(c.get("legal_name")) ? str(c.get("name")) : str(c.get("legal_name")), g.valid(), g.problem(),
                    Gst.normalise(str(c.get("pan_number"))),
                    first(p.get("billing_email"), ws.get("contact_email")),
                    first(p.get("billing_phone"), ws.get("contact_phone")), address, state, from));
        }
        return out;
    }

    /** A GSTIN as stored: valid (kept, with its state) or present-but-malformed (reported, not used). */
    private record Gstin(String valid, String problem, String state) {}

    private static Gstin gstin(String raw) {
        String g = Gst.normalise(raw);
        if (g == null) return new Gstin(null, null, null);
        if (!Gst.validGstin(g)) {
            return new Gstin(null, "The GSTIN on record (" + g + ") is not a valid 15-character GSTIN", null);
        }
        return new Gstin(g, null, Gst.stateOfGstin(g));
    }

    private static boolean blank(Object v) {
        return v == null || v.toString().isBlank();
    }

    private static String str(Object v) {
        return blank(v) ? null : v.toString().strip();
    }

    private static String first(Object... values) {
        for (Object v : values) if (!blank(v)) return v.toString().strip();
        return null;
    }

    private static String join(Object... parts) {
        List<String> out = new ArrayList<>();
        for (Object p : parts) if (!blank(p)) out.add(p.toString().strip());
        return out.isEmpty() ? null : String.join(", ", out);
    }
}
