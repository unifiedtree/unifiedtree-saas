package com.unifiedtree.rbac.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.TreeSet;
import java.util.UUID;

/**
 * Per-person permission overrides ({@code rbac.user_permission_overrides}, V143.17).
 *
 * <p>An override either GRANTs one person a permission their roles do not give
 * them, or DENYs one they would otherwise have. The rule everywhere a
 * permission set is resolved (JWT claim at sign-in, {@code /me}, the
 * {@code @perm} bean) is:
 *
 * <pre>{@code   effective = (role grants ∪ employee baseline ∪ GRANT overrides) − DENY overrides}</pre>
 *
 * DENY wins over every grant, so taking a permission away from one manager is
 * reliable even if a later role change would give it back. An override whose
 * {@code expires_at} has passed is ignored.
 *
 * <p>Reads never throw: permission resolution runs on the sign-in hot path.
 * Before the V143.17 table exists the lookup is skipped (checked with
 * {@code to_regclass}, which cannot abort the caller's transaction), and a
 * failed read degrades to "no overrides" — which never grants anything extra;
 * it can only leave a DENY unapplied until the next read.
 */
@Component
public class PermissionOverrides {

    private static final Logger log = LoggerFactory.getLogger(PermissionOverrides.class);

    public static final String GRANT = "GRANT";
    public static final String DENY = "DENY";

    /** One active override. */
    public record Override(String permissionCode, String effect, OffsetDateTime expiresAt) {
        public boolean isGrant() { return GRANT.equals(effect); }
        public boolean isDeny() { return DENY.equals(effect); }
    }

    private final JdbcTemplate jdbc;
    private volatile boolean tablePresent;

    public PermissionOverrides(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Active (not expired) overrides for one user in the current tenant (RLS). */
    public List<Override> activeFor(UUID userId) {
        if (userId == null || !tableAvailable()) return List.of();
        try {
            return jdbc.query("""
                    SELECT permission_code, effect, expires_at
                      FROM rbac.user_permission_overrides
                     WHERE user_id = ?
                       AND (expires_at IS NULL OR expires_at > now())
                    """,
                    (rs, i) -> new Override(rs.getString(1), rs.getString(2),
                            rs.getObject(3, OffsetDateTime.class)),
                    userId);
        } catch (RuntimeException e) {
            log.warn("PERMISSION_OVERRIDES_READ_FAIL user={} — overrides not applied", userId, e);
            return List.of();
        }
    }

    /**
     * Apply overrides to a base permission set: add every GRANT, then remove
     * every DENY. Pure; sorted and de-duplicated.
     */
    public static List<String> apply(Collection<String> base, Collection<Override> overrides) {
        TreeSet<String> out = new TreeSet<>(base);
        if (overrides == null || overrides.isEmpty()) return List.copyOf(out);
        for (Override o : overrides) if (o.isGrant()) out.add(o.permissionCode());
        for (Override o : overrides) if (o.isDeny()) out.remove(o.permissionCode());
        return List.copyOf(out);
    }

    /**
     * Whether the table exists and this connection may read it. Positive answers
     * are cached; a negative one is re-checked on the next call. Neither check
     * can raise an error, so it can never abort the caller's transaction (a
     * failed statement would, and sign-in writes follow this read).
     */
    private boolean tableAvailable() {
        if (tablePresent) return true;
        try {
            tablePresent = Boolean.TRUE.equals(jdbc.queryForObject("""
                    SELECT CASE WHEN to_regclass('rbac.user_permission_overrides') IS NULL THEN false
                                ELSE has_table_privilege('rbac.user_permission_overrides', 'SELECT') END
                    """, Boolean.class));
        } catch (RuntimeException e) {
            tablePresent = false;
        }
        return tablePresent;
    }
}
