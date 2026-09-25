package com.hrms.api.access;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * Writes one audit.events row for every change to someone's access: a role
 * given or taken away, a per-person override added, changed or removed, and a
 * custom role created, duplicated, changed or deleted. The row carries the
 * before/after in {@code diff}, so the Audit logs drawer shows what changed.
 *
 * <p>Written in the same transaction as the change on purpose: if the audit
 * row cannot be written, the access change is rolled back rather than made
 * without a trace.
 */
@Component
public class AccessAudit {

    public static final String MODULE = "rbac";
    public static final String PERMISSION_CHANGE = "PERMISSION_CHANGE";

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AccessAudit(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /**
     * @param action     PERMISSION_CHANGE, CREATE, UPDATE or DELETE
     * @param entityType USER or ROLE (the Audit logs resource filter)
     */
    public void record(UUID actorId, String action, String entityType, UUID entityId,
                       String summary, Map<String, ?> diff) {
        UUID tenantId = TenantContext.getTenantId();
        String diffJson;
        try {
            diffJson = diff == null ? null : json.writeValueAsString(diff);
        } catch (JsonProcessingException e) {
            diffJson = null;
        }
        jdbc.update("""
                INSERT INTO audit.events
                    (id, tenant_id, occurred_at, occurred_date, actor_user_id, actor_email,
                     module, action, entity_type, entity_id, summary, diff)
                VALUES (gen_random_uuid(), ?, now(), (now() AT TIME ZONE 'Asia/Kolkata')::date, ?,
                        (SELECT email FROM auth.user_credentials WHERE id = ?),
                        ?, ?, ?, ?, ?, CAST(? AS jsonb))
                """,
                tenantId, actorId, actorId, MODULE, action, entityType, entityId, summary, diffJson);
    }
}
