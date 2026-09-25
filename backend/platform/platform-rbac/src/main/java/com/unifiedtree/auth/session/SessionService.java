package com.unifiedtree.auth.session;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * A person's signed-in sessions, read from the refresh-token store
 * (auth.refresh_tokens: one live row per session; refresh rotates the row but
 * keeps session_id), and signing sessions out.
 *
 * <p>Signing a session out deletes its refresh token, so it can't be renewed,
 * AND makes its current access token stop working: access tokens carry the
 * session as the {@code sid} claim and {@link SessionRevocationFilter} asks
 * {@link #isActive} on every request. Answers are cached for 30 seconds per
 * server instance, so on other instances a sign-out takes effect within about
 * 30 seconds; on this instance it is immediate.
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);

    public record SessionView(UUID id, String device, String kind, String ipAddress,
                              OffsetDateTime signedInAt, OffsetDateTime lastActiveAt,
                              OffsetDateTime expiresAt, boolean current) {}

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final Cache<String, Boolean> alive = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofSeconds(30)).maximumSize(200_000).build();
    // Short on purpose: a "not signed in" answer is re-checked against the
    // database every 5 minutes, so one bad read can never lock a person out for
    // the rest of their access token's life. A really signed-out session is
    // simply found gone again.
    private final Cache<String, Boolean> revoked = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(5)).maximumSize(200_000).build();

    public SessionService(JdbcTemplate jdbc, PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
    }

    /** Live sessions of one person, most recently used first. */
    @Transactional(readOnly = true)
    public List<SessionView> list(UUID userId, UUID currentSessionId) {
        List<SessionView> rows = jdbc.query("""
                SELECT COALESCE(session_id, id)                      AS sid,
                       user_agent, ip_address,
                       COALESCE(session_started_at, issued_at)        AS started,
                       GREATEST(COALESCE(last_used_at, issued_at), issued_at) AS last_used,
                       expires_at
                  FROM auth.refresh_tokens
                 WHERE user_id = ? AND revoked_at IS NULL AND expires_at > now()
                 ORDER BY last_used DESC
                """, (rs, n) -> {
                    UUID sid = rs.getObject("sid", UUID.class);
                    String ua = rs.getString("user_agent");
                    return new SessionView(sid, SessionDevice.describe(ua), SessionDevice.kind(ua),
                            rs.getString("ip_address"), ts(rs.getTimestamp("started")), ts(rs.getTimestamp("last_used")),
                            ts(rs.getTimestamp("expires_at")), sid.equals(currentSessionId));
                }, userId);
        // One row per session (a rotation race can briefly leave two).
        Set<UUID> seen = new LinkedHashSet<>();
        List<SessionView> out = new ArrayList<>();
        for (SessionView v : rows) if (seen.add(v.id())) out.add(v);
        return out;
    }

    /** Sign one of this person's sessions out. Returns how many tokens were removed. */
    @Transactional
    public int revoke(UUID tenantId, UUID userId, UUID sessionId) {
        int n = jdbc.update("DELETE FROM auth.refresh_tokens WHERE user_id = ? AND COALESCE(session_id, id) = ?",
                userId, sessionId);
        // Only a session that was this person's: marking any id revoked would let
        // anyone sign someone else out (for the cache's lifetime) by guessing the id.
        if (n > 0) markRevoked(tenantId, sessionId);
        return n;
    }

    /** Sign out every session of this person except {@code keep}. Returns the sessions signed out. */
    @Transactional
    public int revokeOthers(UUID tenantId, UUID userId, UUID keep) {
        List<UUID> sids = jdbc.queryForList("""
                SELECT DISTINCT COALESCE(session_id, id) FROM auth.refresh_tokens
                 WHERE user_id = ? AND COALESCE(session_id, id) <> ?
                """, UUID.class, userId, keep);
        if (sids.isEmpty()) return 0;
        jdbc.update("DELETE FROM auth.refresh_tokens WHERE user_id = ? AND COALESCE(session_id, id) <> ?", userId, keep);
        sids.forEach(s -> markRevoked(tenantId, s));
        return sids.size();
    }

    /** Sign out every session of a person (used after an admin resets their two-factor). */
    @Transactional
    public int revokeAll(UUID tenantId, UUID userId) {
        List<UUID> sids = jdbc.queryForList(
                "SELECT DISTINCT COALESCE(session_id, id) FROM auth.refresh_tokens WHERE user_id = ?", UUID.class, userId);
        jdbc.update("DELETE FROM auth.refresh_tokens WHERE user_id = ?", userId);
        sids.forEach(s -> markRevoked(tenantId, s));
        return sids.size();
    }

    /**
     * Whether an access token's session is still signed in. Also records
     * "last active" (at most once a minute per session). Fails open on a
     * database error, so a blip never signs everyone out.
     */
    public boolean isActive(UUID tenantId, UUID sessionId) {
        String key = tenantId + ":" + sessionId;
        if (revoked.getIfPresent(key) != null) return false;
        if (alive.getIfPresent(key) != null) return true;
        // Always read under the TOKEN's workspace: auth.refresh_tokens is
        // RLS-isolated, and a read under any other workspace finds nothing and
        // would sign the person out.
        UUID previous = TenantContext.getTenantId();
        try {
            TenantContext.setTenantId(tenantId);
            Boolean ok = tx.execute(status -> jdbc.queryForObject("""
                    WITH touched AS (
                        UPDATE auth.refresh_tokens SET last_used_at = now()
                         WHERE tenant_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > now()
                           AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')
                        RETURNING 1)
                    SELECT EXISTS (SELECT 1 FROM auth.refresh_tokens
                                    WHERE tenant_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > now())
                    """, Boolean.class, tenantId, sessionId, tenantId, sessionId));
            if (Boolean.TRUE.equals(ok)) {
                alive.put(key, Boolean.TRUE);
                return true;
            }
            revoked.put(key, Boolean.TRUE);
            return false;
        } catch (RuntimeException e) {
            log.warn("session check failed for tenant={} (letting the request through): {}", tenantId, e.getMessage());
            return true;
        } finally {
            TenantContext.setTenantId(previous);
        }
    }

    private void markRevoked(UUID tenantId, UUID sessionId) {
        String key = tenantId + ":" + sessionId;
        alive.invalidate(key);
        revoked.put(key, Boolean.TRUE);
    }

    private static OffsetDateTime ts(Timestamp t) {
        return t == null ? null : t.toInstant().atOffset(ZoneOffset.UTC);
    }
}
