package com.unifiedtree.rbac.security;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * The self-service permission floor that EVERY human employee holds, no matter
 * which elevated role they were promoted into.
 *
 * <h2>Why this exists</h2>
 * Before this class, "employee" was modelled as a <em>role</em>. Promoting
 * someone to {@code DEPT_MANAGER} replaced their {@code EMPLOYEE} role, which
 * silently revoked every self-service permission that role carried. In
 * production that meant a promoted line manager could no longer enrol their own
 * face, punch in with face recognition, or read their own payslip — the app just
 * returned 403 and the user saw an opaque failure. The 2026-08-18 audit found
 * this affected six roles, with {@code DEPT_MANAGER} missing 10 of the 27
 * baseline permissions and even {@code HR_MANAGER} / {@code SUPER_ADMIN} unable
 * to read their own payslip.
 *
 * <h2>The corrected model</h2>
 * Being an employee is a <strong>fact</strong>, not a role: it is true of anyone
 * whose credentials carry an {@code employee_id}. A manager still clocks in. A
 * finance lead still has a payslip. So the permission set for such a user is:
 *
 * <pre>{@code   effective = union(perms of assigned roles) ∪ EMPLOYEE_BASELINE }</pre>
 *
 * <h2>Why the baseline is read from the DB, not hard-coded</h2>
 * The baseline is defined as "whatever the {@code EMPLOYEE} role currently
 * grants". Adding a new self-service permission is therefore a single grant to
 * {@code EMPLOYEE} and every human in every tenant inherits it on their next
 * login — no code change, no per-role fan-out, and no possibility of a newly
 * seeded role forgetting it. That is what stops this class of bug recurring.
 *
 * <h2>Caching</h2>
 * The baseline changes only when an operator re-grants the {@code EMPLOYEE}
 * role, which is rare. A 5-minute TTL keeps steady-state cost at roughly one
 * query per five minutes while bounding how long a grant takes to propagate.
 * A failed load returns the last known-good value rather than an empty set:
 * returning empty would strip every employee of self-service access during a
 * transient DB blip, turning a small outage into a total lockout.
 */
@Component
public class EmployeeBaselinePermissions {

    private static final Logger log = LoggerFactory.getLogger(EmployeeBaselinePermissions.class);

    /** The role whose grants define the floor for every human employee. */
    private static final String BASELINE_ROLE_CODE = "EMPLOYEE";

    private static final String CACHE_KEY = "baseline";

    private final JdbcTemplate jdbc;

    private final Cache<String, Set<String>> cache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(1)
            .build();

    /**
     * Last successfully loaded baseline. Serves reads while the DB is
     * unreachable so a transient failure degrades to "slightly stale" instead
     * of "every employee loses self-service".
     */
    private volatile Set<String> lastKnownGood = Set.of();

    public EmployeeBaselinePermissions(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Permission codes every user with an employee record implicitly holds.
     * Never throws — callers resolve permissions on the login hot path and must
     * not fail a sign-in because this lookup hiccuped.
     */
    public Set<String> baseline() {
        Set<String> cached = cache.getIfPresent(CACHE_KEY);
        if (cached != null) return cached;
        try {
            List<String> codes = jdbc.queryForList("""
                    SELECT rp.permission_code
                      FROM rbac.role_permissions rp
                      JOIN rbac.roles r ON r.id = rp.role_id
                     WHERE r.code = ?
                    """, String.class, BASELINE_ROLE_CODE);
            Set<String> loaded = Set.copyOf(codes);
            if (loaded.isEmpty()) {
                // An empty EMPLOYEE role means the seed is broken or a migration
                // is mid-flight. Prefer the previous value over silently
                // narrowing everyone's access.
                log.error("EMPLOYEE_BASELINE_EMPTY role={} returned no permissions; "
                        + "serving last-known-good ({} codes). Check rbac seed data.",
                        BASELINE_ROLE_CODE, lastKnownGood.size());
                return lastKnownGood;
            }
            cache.put(CACHE_KEY, loaded);
            lastKnownGood = loaded;
            return loaded;
        } catch (RuntimeException e) {
            log.error("EMPLOYEE_BASELINE_LOAD_FAIL serving last-known-good ({} codes)",
                    lastKnownGood.size(), e);
            return lastKnownGood;
        }
    }

    /**
     * Effective permissions for one principal.
     *
     * @param rolePermissions permissions from the user's assigned roles
     * @param employeeId      the credential's {@code employee_id}; {@code null}
     *                        for machine or platform-only principals, which get
     *                        no employee baseline because they have no payslip,
     *                        no face to enrol and nothing to clock in to
     * @return sorted, de-duplicated effective permission codes
     */
    public List<String> effectiveFor(java.util.Collection<String> rolePermissions,
                                     java.util.UUID employeeId) {
        java.util.TreeSet<String> effective = new java.util.TreeSet<>(rolePermissions);
        if (employeeId != null) {
            effective.addAll(baseline());
        }
        return List.copyOf(effective);
    }

    /** Drop the cached baseline; call after re-granting the EMPLOYEE role. */
    public void invalidate() {
        cache.invalidateAll();
    }
}
