package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Days I punched in but never out, with no fix sent for them yet.
 *
 * <ul>
 *   <li>Who: {@code attendance.checkin.self} (my attendance and fix requests), attendance module.</li>
 *   <li>Which days: before today, within the {@value #LOOK_BACK_DAYS} days a fix may still be
 *       asked for (CORRECTION_DATE_TOO_OLD), and not a punch-in from the last
 *       {@value #OPEN_HOURS} hours: that one is still open (a night shift), as
 *       {@code AttendanceService.checkOut} treats it.</li>
 *   <li>A day with a fix waiting or approved is left out; after a rejected fix the day shows again.</li>
 * </ul>
 */
@Component
class MissedPunchOutSource implements NeedsYouSource {

    static final int LOOK_BACK_DAYS = 90;
    static final int OPEN_HOURS = 20;
    static final int MAX_ROWS = 10;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEE, d MMM", Locale.ENGLISH);

    private final JdbcTemplate jdbc;
    Clock clock = Clock.systemUTC();

    MissedPunchOutSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "MISSED_PUNCH_OUT"; }
    @Override public String module() { return "attendance"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("attendance.checkin.self"); }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        LocalDate today = caller.today();
        Timestamp stillOpenAfter = Timestamp.from(clock.instant().minus(Duration.ofHours(OPEN_HOURS)));
        return jdbc.query("""
                SELECT r.id, r.attendance_date
                  FROM attendance.records r
                 WHERE r.tenant_id = ? AND r.employee_id = ?
                   AND r.attendance_date >= ? AND r.attendance_date < ?
                   AND r.check_in_at IS NOT NULL AND r.check_out_at IS NULL
                   AND r.check_in_at < ?
                   AND NOT EXISTS (SELECT 1 FROM attendance.regularization_requests c
                                    WHERE c.tenant_id = r.tenant_id AND c.employee_id = r.employee_id
                                      AND c.missing_for_date = r.attendance_date
                                      AND c.status IN ('PENDING', 'APPROVED'))
                 ORDER BY r.attendance_date DESC
                 LIMIT ?
                """, (rs, i) -> {
                    LocalDate day = rs.getObject("attendance_date", LocalDate.class);
                    return new NeedsYouItem("MISSED_PUNCH_OUT", "Fix your missed punch-out",
                            "No punch-out on " + DAY.format(day), day, null, NeedsYouItem.BAD,
                            rs.getObject("id", UUID.class), 1, "/hrms/attendance?tab=my");
                }, caller.tenantId(), caller.employeeId(), today.minusDays(LOOK_BACK_DAYS), today, stillOpenAfter, MAX_ROWS);
    }
}
