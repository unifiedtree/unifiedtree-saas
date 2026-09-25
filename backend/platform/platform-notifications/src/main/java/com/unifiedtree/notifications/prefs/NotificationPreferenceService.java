package com.unifiedtree.notifications.prefs;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Reads and writes people's notification choices
 * ({@code auth.user_credentials.notification_preferences}) and answers "may
 * this person get this notification on this channel?" for the senders.
 *
 * <p>The sender-facing reads are {@code REQUIRES_NEW} with the tenant set
 * explicitly: they run from AFTER_COMMIT listeners, async mail threads and
 * scheduled jobs (memory: rls-after-commit trap — auth.user_credentials is
 * FORCE ROW LEVEL SECURITY, so a read on a connection without the tenant GUC
 * silently finds nobody). When the lookup fails the defaults apply, which are
 * what everyone got before preferences were honoured.
 */
@Service
public class NotificationPreferenceService {

    private static final Logger log = LoggerFactory.getLogger(NotificationPreferenceService.class);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    /** The person a notification is for: their account, email, company and saved choices. */
    public record Recipient(UUID userId, String email, UUID companyId, Map<String, Object> prefs) {
        public static Recipient unknown() { return new Recipient(null, null, null, null); }
    }

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public NotificationPreferenceService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /**
     * Resolves a notification recipient id — an employee id (what
     * {@code notif.notifications.user_id} holds) or, for accounts with no
     * employee record, the account id.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Recipient recipient(UUID tenantId, UUID recipientId) {
        return findRecipient(tenantId, recipientId);
    }

    /** Resolves a recipient by the email address they sign in with. */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Recipient recipientByEmail(UUID tenantId, String email) {
        if (tenantId == null || email == null || email.isBlank()) return Recipient.unknown();
        try {
            bind(tenantId);
            List<Recipient> rows = jdbc.query("""
                    SELECT uc.id, uc.email, uc.notification_preferences::text AS prefs, e.company_id
                      FROM auth.user_credentials uc
                      LEFT JOIN hrms.employees e ON e.id = uc.employee_id AND e.tenant_id = uc.tenant_id
                     WHERE uc.tenant_id = ? AND lower(uc.email) = lower(?)
                     ORDER BY uc.is_active DESC
                     LIMIT 1
                    """, (rs, i) -> new Recipient(rs.getObject(1, UUID.class), rs.getString(2),
                    rs.getObject(4, UUID.class), parse(rs.getString(3))), tenantId, email.trim());
            return rows.isEmpty() ? Recipient.unknown() : rows.get(0);
        } catch (Exception ex) {
            log.warn("Preference lookup by email failed (tenant={}): {}", tenantId, ex.toString());
            return Recipient.unknown();
        }
    }

    /**
     * May this address be emailed about this event? Essential and external
     * events always may. People who are not workspace users (no account with
     * that address) have no choices to honour, so they may too.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public boolean emailAllowed(UUID tenantId, String email, String eventKey) {
        EventDef def = NotificationEventCatalog.byKey(eventKey).orElse(null);
        if (def == null || def.essential() || def.external()) return true;
        Recipient r = recipientByEmail(tenantId, email);
        return NotificationPreferences.decide(def, r.prefs()).email();
    }

    // ── the signed-in user's own choices (controller) ────────────────────────

    /** The stored choices of one account (empty map when none were saved). */
    @Transactional(readOnly = true)
    public Map<String, Object> load(UUID tenantId, UUID userId) {
        bind(tenantId);
        List<String> rows = jdbc.queryForList(
                "SELECT notification_preferences::text FROM auth.user_credentials WHERE id = ? AND tenant_id = ?",
                String.class, userId, tenantId);
        if (rows.isEmpty()) throw new IllegalStateException("Account not found");
        Map<String, Object> m = parse(rows.get(0));
        return m == null ? new LinkedHashMap<>() : m;
    }

    /** Stores the complete choices map for one account. */
    @Transactional
    public void store(UUID tenantId, UUID userId, Map<String, Object> prefs) {
        bind(tenantId);
        String json;
        try {
            json = mapper.writeValueAsString(prefs);
        } catch (Exception e) {
            throw new IllegalArgumentException("Those notification choices couldn't be saved.");
        }
        int n = jdbc.update("""
                UPDATE auth.user_credentials
                   SET notification_preferences = CAST(? AS jsonb), updated_at = now()
                 WHERE id = ? AND tenant_id = ?
                """, json, userId, tenantId);
        if (n == 0) throw new IllegalStateException("Account not found");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private Recipient findRecipient(UUID tenantId, UUID recipientId) {
        if (tenantId == null || recipientId == null) return Recipient.unknown();
        try {
            bind(tenantId);
            List<Recipient> rows = jdbc.query("""
                    SELECT uc.id, COALESCE(uc.email, e.email) AS email,
                           uc.notification_preferences::text AS prefs, e.company_id
                      FROM (SELECT CAST(? AS uuid) AS rid) r
                      LEFT JOIN auth.user_credentials uc
                             ON uc.tenant_id = ? AND (uc.employee_id = r.rid OR uc.id = r.rid)
                      LEFT JOIN hrms.employees e
                             ON e.tenant_id = ? AND e.id = COALESCE(uc.employee_id, r.rid)
                     ORDER BY (uc.id = r.rid) DESC NULLS LAST, uc.is_active DESC NULLS LAST
                     LIMIT 1
                    """, (rs, i) -> new Recipient(rs.getObject(1, UUID.class), rs.getString(2),
                    rs.getObject(4, UUID.class), parse(rs.getString(3))), recipientId, tenantId, tenantId);
            return rows.isEmpty() ? Recipient.unknown() : rows.get(0);
        } catch (Exception ex) {
            log.warn("Recipient lookup failed for {} (tenant={}): {}", recipientId, tenantId, ex.toString());
            return Recipient.unknown();
        }
    }

    private void bind(UUID tenantId) {
        jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
    }

    private Map<String, Object> parse(String json) {
        if (json == null || json.isBlank() || "null".equals(json)) return null;
        try {
            return mapper.readValue(json, MAP);
        } catch (Exception e) {
            log.warn("Unreadable notification_preferences JSON ignored: {}", e.getMessage());
            return null;
        }
    }
}
