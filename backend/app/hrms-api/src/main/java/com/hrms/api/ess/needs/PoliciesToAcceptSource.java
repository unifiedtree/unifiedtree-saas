package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Published policies that ask to be acknowledged and that I haven't
 * acknowledged in their current version: the same rule as
 * {@code PolicyService.needsAcknowledgment} and the policy reminders
 * (every live employee of the workspace is asked). Needs
 * {@code hrms.policy.acknowledge.self}; hrms module. "Accept by" dates come with
 * the policy deadlines (BW-105) and join this item then.
 */
@Component
class PoliciesToAcceptSource implements NeedsYouSource {

    private final JdbcTemplate jdbc;

    PoliciesToAcceptSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "POLICY_TO_ACCEPT"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("hrms.policy.acknowledge.self"); }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        return jdbc.query("""
                SELECT p.id, p.title, p.category, p.policy_version
                  FROM policy_mgmt.hr_policies p
                 WHERE p.tenant_id = ? AND p.status = 'ACTIVE' AND p.acknowledgement_required = TRUE
                   AND NOT EXISTS (SELECT 1 FROM policy_mgmt.policy_acknowledgements a
                                    WHERE a.tenant_id = p.tenant_id AND a.policy_id = p.id AND a.employee_id = ?
                                      AND a.policy_version IS NOT DISTINCT FROM p.policy_version)
                 ORDER BY p.published_at NULLS LAST, p.title
                """, (rs, i) -> {
                    String title = rs.getString("title");
                    String category = com.hrms.api.ess.Rows.pretty(rs.getString("category"));
                    String version = rs.getString("policy_version");
                    String detail = category == null ? null : category + (version == null || version.isBlank() ? "" : " · v" + version.trim());
                    return new NeedsYouItem("POLICY_TO_ACCEPT", "Accept " + (title == null ? "the policy" : title.trim()),
                            detail, null, null, NeedsYouItem.BRAND, rs.getObject("id", UUID.class), 1,
                            // The policy page opens the one named by ?policy= (as search links do).
                            "/hrms/policies?policy=" + rs.getObject("id", UUID.class));
                }, caller.tenantId(), caller.employeeId());
    }
}
