package com.unifiedtree.saas.admin.support;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.net.InetAddress;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Writes an operator's actions to the platform's audit trail ({@code audit.events}
 * rows of the platform tenant, which an operator request is bound to).
 *
 * <ul>
 *   <li>{@link #recordInTransaction}: for changes to money and entitlements (prices,
 *       invoices, billing details, product switches, Marketing billing mode). The row
 *       is written on the change's own connection, so the change and its audit row
 *       commit together or not at all: a change cannot persist without its record.</li>
 *   <li>{@link #record}: best effort, its own transaction ({@link AuditService} logs a
 *       failure rather than failing the request). Used for operator reads of
 *       workspace data ({@link PlatformReadAudit}), where losing an audit row must not
 *       fail the read.</li>
 * </ul>
 */
@Component
public class PlatformAuditTrail {

    public static final String MODULE = "platform";

    private static final Pattern IPV4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");
    private static final ObjectMapper DIFF_JSON = new ObjectMapper();

    private final AuditService audit;
    private final JdbcTemplate jdbc;

    public PlatformAuditTrail(AuditService audit, JdbcTemplate jdbc) {
        this.audit = audit;
        this.jdbc = jdbc;
    }

    /** Best effort, own transaction. */
    public void record(Operator operator, HttpServletRequest request, String action, String entityType,
                       UUID entityId, String summary) {
        audit.recordAs(operator.userId(), operator.email(), clientIp(request),
                request == null ? null : request.getHeader("User-Agent"),
                MODULE, action, entityType, entityId, summary);
    }

    /**
     * In the caller's transaction (there must be one): if the audit row cannot be written the
     * change rolls back with it. The row belongs to the tenant the request is bound to (the
     * platform tenant for an operator), which is what audit.events' insert policy accepts.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordInTransaction(Operator operator, HttpServletRequest request, String action,
                                    String entityType, UUID entityId, String summary) {
        insertInTransaction(operator.userId(), operator.email(), clientIp(request),
                request == null ? null : request.getHeader("User-Agent"), MODULE, action, entityType, entityId,
                summary);
    }

    /**
     * One audit.events row for the tenant bound to the current transaction, written with JDBC on that
     * transaction's connection (so it is safe inside {@link TenantScopedReader#write}, where JPA is not).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void insertInTransaction(UUID actorUserId, String actorEmail, String ip, String userAgent, String module,
                                    String action, String entityType, UUID entityId, String summary) {
        insertInTransaction(actorUserId, actorEmail, ip, userAgent, module, action, entityType, entityId, summary, null);
    }

    /** The same, with the row's {@code diff} details (written as JSON; details that cannot be written are left out). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void insertInTransaction(UUID actorUserId, String actorEmail, String ip, String userAgent, String module,
                                    String action, String entityType, UUID entityId, String summary,
                                    Map<String, ?> diff) {
        Instant now = Instant.now();
        jdbc.update("""
                INSERT INTO audit.events
                       (id, tenant_id, occurred_at, occurred_date, actor_user_id, actor_email, actor_ip,
                        actor_user_agent, module, action, entity_type, entity_id, summary, diff)
                VALUES (?, ?, ?, ?, ?, ?, CAST(? AS inet), ?, ?, ?, ?, ?, ?, CAST(? AS jsonb))
                """, UUID.randomUUID(), TenantContext.getTenantId(), Timestamp.from(now),
                LocalDate.ofInstant(now, ZoneOffset.UTC), actorUserId, clip(actorEmail, 255), ipLiteral(ip),
                clip(userAgent, 500), module, action, entityType, entityId, summary, json(diff));
    }

    private static String json(Map<String, ?> diff) {
        if (diff == null) return null;
        try {
            return DIFF_JSON.writeValueAsString(diff);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    /** The caller: first hop of X-Forwarded-For (Cloud Run puts the client there), else the socket address. */
    public static String clientIp(HttpServletRequest request) {
        if (request == null) return null;
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",")[0].trim();
        return request.getRemoteAddr();
    }

    /**
     * The address only when it is an IP literal (X-Forwarded-For is caller-supplied text, and a bad
     * value cast to inet would fail the change it audits). Never resolves a host name: a value
     * without ':' must be dotted IPv4, and Java parses one with ':' as an IPv6 literal only.
     */
    static String ipLiteral(String ip) {
        if (ip == null || ip.isBlank() || ip.length() > 45) return null;
        String s = ip.trim();
        try {
            if (s.indexOf(':') < 0) {
                var m = IPV4.matcher(s);
                if (!m.matches()) return null;
                for (int g = 1; g <= 4; g++) if (Integer.parseInt(m.group(g)) > 255) return null;
                return s;
            }
            if (!s.matches("^[0-9A-Fa-f:.]+$")) return null;
            return InetAddress.getByName(s).getHostAddress();
        } catch (Exception e) {
            return null;
        }
    }

    private static String clip(String s, int max) {
        if (s == null || s.isBlank()) return null;
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max);
    }
}
