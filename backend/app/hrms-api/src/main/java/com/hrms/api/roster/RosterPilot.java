package com.hrms.api.roster;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Shift planning's pilot (owner, 11 Oct 2026): Phase 1 is switched on only for the test businesses on one list,
 * by business subdomain ({@code unifiedtree.roster.pilot-tenants}, env {@code UNIFIEDTREE_ROSTER_PILOT_TENANTS};
 * comma-separated, spaces and case ignored; empty = nobody). Real customers join the list only after the owner's OK.
 *
 * <p>For every other business each shift-planning endpoint (rotation patterns, roster settings, rosters with check,
 * publish, discard and history, schedule me/team, people and preview, the Excel template, validate, apply and
 * export) answers 403 {@code FEATURE_NOT_ENABLED} before it reads or writes anything: {@link RosterTables#require()}
 * and {@link PlannerScopeService#actor} ask {@link #require()} first. The web reads {@link #enabled()} once a session
 * ({@code GET /v1/rosters/availability}) and shows no way into shift planning when it is off.
 *
 * <p>Attendance is the same for every business either way: nothing outside shift planning reads its tables in
 * Phase 1.
 */
@Component
public class RosterPilot {

    private static final Logger log = LoggerFactory.getLogger(RosterPilot.class);

    public static final String CODE = "FEATURE_NOT_ENABLED";
    /** The test businesses' subdomains (owner, 11 Oct 2026). */
    public static final String DEFAULT_TENANTS = "demo-hrms,demotech,srcai,srcai2026,sri,ionora,unity";
    static final String MESSAGE = "Shift planning isn't switched on for this business yet.";

    private final JdbcTemplate jdbc;
    private final Set<String> subdomains;

    public RosterPilot(JdbcTemplate jdbc,
                       @Value("${unifiedtree.roster.pilot-tenants:" + DEFAULT_TENANTS + "}") String tenants) {
        this.jdbc = jdbc;
        this.subdomains = parse(tenants);
        log.info("Shift planning pilot: {} business(es) {}", subdomains.size(), subdomains);
    }

    /** The list as written: comma-separated subdomains; spaces around them and their case don't matter. */
    static Set<String> parse(String csv) {
        Set<String> out = new LinkedHashSet<>();
        if (csv == null) return Set.of();
        Arrays.stream(csv.split(","))
                .map(s -> s.trim().toLowerCase(Locale.ROOT))
                .filter(s -> !s.isEmpty())
                .forEach(out::add);
        return Collections.unmodifiableSet(out);
    }

    /** The subdomains on the list (lower case). */
    public Set<String> subdomains() {
        return subdomains;
    }

    /** Whether the business the request runs in may use shift planning. */
    public boolean enabled() {
        return enabled(TenantContext.getTenantId());
    }

    /** Whether this business may use shift planning: its subdomain is on the list. */
    public boolean enabled(UUID tenantId) {
        if (tenantId == null || subdomains.isEmpty()) return false;
        String subdomain = subdomain(tenantId);
        return subdomain != null && subdomains.contains(subdomain.trim().toLowerCase(Locale.ROOT));
    }

    /** 403 {@code FEATURE_NOT_ENABLED} for a business that is not on the list. */
    public void require() {
        if (!enabled()) throw notEnabled();
    }

    static HrmsException notEnabled() {
        return new HrmsException(MESSAGE, HttpStatus.FORBIDDEN, CODE);
    }

    /** The business's subdomain, or null when there is no such business. Package-visible for unit tests. */
    String subdomain(UUID tenantId) {
        List<String> rows = jdbc.queryForList("SELECT subdomain FROM platform.tenants WHERE id = ?", String.class, tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
