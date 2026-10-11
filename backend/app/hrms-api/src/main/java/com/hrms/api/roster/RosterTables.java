package com.hrms.api.roster;

import com.hrms.core.exception.FeatureNotReady;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Whether shift planning's tables (V143.106) are there. Production applies migrations by hand,
 * later, so every roster, pattern and schedule endpoint asks first and answers 503
 * {@code FEATURE_NOT_READY} while they are missing (the web then shows "Shift planning isn't
 * switched on yet." in the planner tab only). A catalog read; it never fails the request itself.
 * Before that, {@link #require()} refuses a business outside shift planning's pilot (403
 * {@code FEATURE_NOT_ENABLED}, {@link RosterPilot}).
 */
@Component
public class RosterTables {

    /** The nine tables of V143.106. */
    static final String[] TABLES = {
            "attendance.rotation_templates", "attendance.rotation_template_days", "attendance.rosters",
            "attendance.roster_members", "attendance.roster_staffing", "attendance.roster_cells",
            "attendance.schedule_days", "attendance.schedule_day_history", "attendance.roster_settings"};

    private static final String READY_SQL;
    static {
        StringBuilder sql = new StringBuilder("SELECT ");
        for (int i = 0; i < TABLES.length; i++) {
            if (i > 0) sql.append(" AND ");
            sql.append("to_regclass('").append(TABLES[i]).append("') IS NOT NULL");
        }
        READY_SQL = sql.toString();
    }

    private final JdbcTemplate jdbc;
    private final RosterPilot pilot;
    /** Once the tables are there they stay: a positive answer is kept, a negative one asked again. */
    private volatile boolean seen;

    public RosterTables(JdbcTemplate jdbc, RosterPilot pilot) {
        this.jdbc = jdbc;
        this.pilot = pilot;
    }

    public boolean ready() {
        if (seen) return true;
        try {
            seen = Boolean.TRUE.equals(jdbc.queryForObject(READY_SQL, Boolean.class));
        } catch (RuntimeException e) {
            return false;
        }
        return seen;
    }

    /**
     * The first line of every shift-planning endpoint: 403 {@code FEATURE_NOT_ENABLED} for a business outside the
     * pilot ({@link RosterPilot#require()}), then {@link FeatureNotReady} while V143.106 is not applied.
     */
    public void require() {
        pilot.require();
        if (!ready()) throw new FeatureNotReady();
    }
}
