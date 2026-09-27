package com.hrms.api.workforce;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Add-employee drafts (redesign BW-92): the unfinished form, saved as JSON in
 * {@code hrms.employee_drafts} (V143_52, JDBC only). A draft belongs to the
 * user who saved it: every statement filters on the tenant and on that user,
 * so nobody else can list, open, change or delete it. PAN, Aadhaar, passport,
 * UAN, ESI and bank details are removed before saving
 * ({@link EmployeeDraftPayload#strip}). Until the migration is applied every
 * call answers FEATURE_NOT_READY.
 */
@Service
public class EmployeeDraftService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public EmployeeDraftService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /**
     * One draft. {@code strippedFields} lists what the save removed (empty on
     * reads), so the form can tell the person to fill those in again.
     */
    public record Draft(UUID id, UUID companyId, String displayName, JsonNode payload,
                        Instant createdAt, Instant updatedAt, List<String> strippedFields) {}

    public record SaveRequest(UUID companyId, JsonNode payload) {}

    private static final String COLUMNS = "id, company_id, payload::text AS payload, created_at, updated_at";

    @Transactional(readOnly = true)
    public List<Draft> list(UUID userId, UUID companyId) {
        UUID tenant = tenant();
        return FeatureNotReady.guard(() -> jdbc.query(
                "SELECT " + COLUMNS + " FROM hrms.employee_drafts"
                        + " WHERE tenant_id = ? AND created_by_user_id = ?"
                        + " AND (CAST(? AS uuid) IS NULL OR company_id = CAST(? AS uuid))"
                        + " ORDER BY updated_at DESC, id",
                mapper(List.of()), tenant, userId, str(companyId), str(companyId)));
    }

    @Transactional(readOnly = true)
    public Draft get(UUID userId, UUID id) {
        return FeatureNotReady.guard(() -> find(tenant(), userId, id, List.of()));
    }

    @Transactional
    public Draft create(UUID userId, SaveRequest req) {
        UUID tenant = tenant();
        UUID companyId = requireCompany(tenant, req == null ? null : req.companyId());
        ObjectNode payload = payloadOf(req);
        List<String> stripped = EmployeeDraftPayload.strip(payload);
        String text = checkedText(payload);
        return FeatureNotReady.guard(() -> {
            UUID id = jdbc.queryForObject("""
                    INSERT INTO hrms.employee_drafts (tenant_id, company_id, created_by_user_id, payload)
                    VALUES (?, ?, ?, CAST(? AS jsonb))
                    RETURNING id
                    """, UUID.class, tenant, companyId, userId, text);
            return find(tenant, userId, id, stripped);
        });
    }

    /** Replaces the saved form. A companyId in the request moves the draft to that company. */
    @Transactional
    public Draft update(UUID userId, UUID id, SaveRequest req) {
        UUID tenant = tenant();
        UUID companyId = req == null || req.companyId() == null ? null : requireCompany(tenant, req.companyId());
        ObjectNode payload = payloadOf(req);
        List<String> stripped = EmployeeDraftPayload.strip(payload);
        String text = checkedText(payload);
        return FeatureNotReady.guard(() -> {
            int n = jdbc.update("""
                    UPDATE hrms.employee_drafts
                       SET payload = CAST(? AS jsonb), company_id = COALESCE(CAST(? AS uuid), company_id), updated_at = now()
                     WHERE tenant_id = ? AND created_by_user_id = ? AND id = ?
                    """, text, str(companyId), tenant, userId, id);
            if (n == 0) throw notFound();
            return find(tenant, userId, id, stripped);
        });
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        UUID tenant = tenant();
        int n = FeatureNotReady.guard(() -> jdbc.update(
                "DELETE FROM hrms.employee_drafts WHERE tenant_id = ? AND created_by_user_id = ? AND id = ?",
                tenant, userId, id));
        if (n == 0) throw notFound();
    }

    private Draft find(UUID tenant, UUID userId, UUID id, List<String> stripped) {
        List<Draft> rows = jdbc.query(
                "SELECT " + COLUMNS + " FROM hrms.employee_drafts WHERE tenant_id = ? AND created_by_user_id = ? AND id = ?",
                mapper(stripped), tenant, userId, id);
        if (rows.isEmpty()) throw notFound();
        return rows.get(0);
    }

    private RowMapper<Draft> mapper(List<String> stripped) {
        return (rs, i) -> {
            JsonNode payload = read(rs.getString("payload"));
            return new Draft(rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class),
                    EmployeeDraftPayload.displayName(payload), payload,
                    rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant(),
                    List.copyOf(stripped));
        };
    }

    private JsonNode read(String text) {
        try {
            return text == null ? json.createObjectNode() : json.readTree(text);
        } catch (JsonProcessingException e) {
            return json.createObjectNode();
        }
    }

    static ObjectNode payloadOf(SaveRequest req) {
        JsonNode p = req == null ? null : req.payload();
        if (p == null || p.isNull()) throw new BusinessRuleException("The draft is empty", "DRAFT_PAYLOAD_REQUIRED");
        if (!(p instanceof ObjectNode o)) throw new BusinessRuleException("A draft must be a form (a JSON object)", "DRAFT_PAYLOAD_INVALID");
        return o.deepCopy();
    }

    private String checkedText(ObjectNode payload) {
        String text;
        try {
            text = json.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new BusinessRuleException("The draft could not be read", "DRAFT_PAYLOAD_INVALID");
        }
        if (text.length() > EmployeeDraftPayload.MAX_CHARS) {
            throw new BusinessRuleException("The draft is too large to save", "DRAFT_TOO_LARGE");
        }
        return text;
    }

    private UUID requireCompany(UUID tenant, UUID companyId) {
        if (companyId == null) throw new BusinessRuleException("Pick a company for the draft", "DRAFT_COMPANY_REQUIRED");
        Boolean exists = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM org.companies WHERE tenant_id = ? AND id = ?)", Boolean.class, tenant, companyId);
        if (!Boolean.TRUE.equals(exists)) throw new BusinessRuleException("That company isn't in this workspace", "DRAFT_COMPANY_UNKNOWN");
        return companyId;
    }

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Draft not found");
    }

    private static UUID tenant() { return TenantContext.getTenantId(); }
    private static String str(UUID id) { return id == null ? null : id.toString(); }
}
