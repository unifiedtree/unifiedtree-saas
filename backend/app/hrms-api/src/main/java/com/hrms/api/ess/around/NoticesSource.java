package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.Rows;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.employee.entity.Employee;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * The company's notices (the dashboard's notices, open to anyone signed in):
 * current ones only, not archived and not expired.
 *
 * <ul>
 *   <li>A notice with an event date ({@code hrms.company_notices.event_date},
 *       added by the dashboard package's migration) shows on that day, when it
 *       falls in the window.</li>
 *   <li>A notice without one shows on the day it was posted, when that was
 *       within the same number of days back ({@code dateKind} POSTED).</li>
 * </ul>
 * Until that migration is applied the column doesn't exist: this source checks
 * for it first and then reads notices without event dates, so Home works either
 * way. If the column disappears between the check and the read, the database's
 * "undefined column" becomes {@link FeatureNotReady} and only this source is
 * reported unavailable.
 */
@Component
class NoticesSource implements AroundSource {

    static final int DETAIL_CHARS = 160;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;

    NoticesSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "NOTICE"; }
    @Override public String module() { return null; }
    @Override public boolean allowed(EssCaller caller) { return true; }

    /** Whether the event-date column is there yet (a catalogue read; never fails on a missing table or column). */
    boolean hasEventDate() {
        Boolean has = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM pg_attribute
                                WHERE attrelid = to_regclass('hrms.company_notices')
                                  AND attname = 'event_date' AND NOT attisdropped)
                """, Boolean.class);
        return Boolean.TRUE.equals(has);
    }

    @Override
    public List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to) {
        long days = java.time.temporal.ChronoUnit.DAYS.between(from, to);
        Timestamp postedSince = Timestamp.from(from.minusDays(days).atStartOfDay(IST).toInstant());
        if (!hasEventDate()) {
            return FeatureNotReady.guard(() -> jdbc.query("""
                    SELECT n.id, n.title, n.body, n.created_at, NULL::date AS event_date
                      FROM hrms.company_notices n
                     WHERE n.tenant_id = ? AND n.company_id = ? AND NOT n.archived
                       AND (n.expires_on IS NULL OR n.expires_on >= ?)
                       AND n.created_at >= ?
                     ORDER BY n.created_at DESC, n.id
                    """, (rs, i) -> item(rs), caller.tenantId(), me.getCompanyId(), from, postedSince));
        }
        return FeatureNotReady.guard(() -> jdbc.query("""
                SELECT n.id, n.title, n.body, n.created_at, n.event_date
                  FROM hrms.company_notices n
                 WHERE n.tenant_id = ? AND n.company_id = ? AND NOT n.archived
                   AND (n.expires_on IS NULL OR n.expires_on >= ?)
                   AND ((n.event_date IS NOT NULL AND n.event_date BETWEEN ? AND ?)
                     OR (n.event_date IS NULL AND n.created_at >= ?))
                 ORDER BY COALESCE(n.event_date, n.created_at::date), n.id
                """, (rs, i) -> item(rs), caller.tenantId(), me.getCompanyId(), from, from, to, postedSince));
    }

    private static AroundItem item(java.sql.ResultSet rs) throws java.sql.SQLException {
        LocalDate event = rs.getObject("event_date", LocalDate.class);
        java.time.Instant posted = Rows.instant(rs, "created_at");
        LocalDate date = event != null ? event : posted == null ? null : posted.atZone(IST).toLocalDate();
        return new AroundItem("NOTICE", date, event != null ? "ON" : "POSTED", rs.getString("title"),
                excerpt(rs.getString("body")), null, rs.getObject("id", UUID.class), null, null, null, null);
    }

    /** The first line or so of the body, cut at a word near {@link #DETAIL_CHARS}. */
    static String excerpt(String body) {
        if (body == null) return null;
        String s = body.replaceAll("\\s+", " ").trim();
        if (s.length() <= DETAIL_CHARS) return s.isEmpty() ? null : s;
        int cut = s.lastIndexOf(' ', DETAIL_CHARS);
        return s.substring(0, cut > DETAIL_CHARS / 2 ? cut : DETAIL_CHARS).trim() + "…";
    }
}
