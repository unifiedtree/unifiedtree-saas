package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.TextStyle;
import java.util.Locale;
import java.util.UUID;

/**
 * The monthly overtime cap (BW-29), shared by punch overtime ({@link OvertimeController}) and requested overtime
 * ({@link OvertimeRequestService}): an approval is refused when the person's approved overtime in that calendar month,
 * plus this one, would go past the company's cap. Approved punch overtime counts while its decision is still in force
 * (it was reviewed for the minutes stored now); approved requests count when their table exists. Locked per person,
 * so two approvers acting at once can't both slip under the cap. Runs inside the caller's transaction and never fails
 * on a missing requests table (a catalog check first).
 */
@Component
public class OvertimeCap {

    private final JdbcTemplate jdbc;

    public OvertimeCap(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void requireWithin(UUID tenant, UUID employee, LocalDate day, int counted, Integer cap,
                              UUID excludeRecord, UUID excludeRequest) {
        if (cap == null) return;
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", (ResultSetExtractor<Void>) rs -> null,
                "overtime-cap:" + tenant + ":" + employee);
        LocalDate first = day.withDayOfMonth(1), last = day.withDayOfMonth(day.lengthOfMonth());
        Integer punches = jdbc.queryForObject("""
                SELECT COALESCE(SUM(d.reviewed_minutes),0)::int FROM attendance.overtime_decisions d
                JOIN attendance.records rec ON rec.id=d.record_id AND rec.attendance_date=d.record_date AND rec.tenant_id=d.tenant_id
                WHERE d.tenant_id=? AND rec.employee_id=? AND d.status='APPROVED' AND d.reviewed_minutes=rec.overtime_minutes
                  AND d.record_date BETWEEN ? AND ? AND d.record_id IS DISTINCT FROM CAST(? AS uuid)
                """, Integer.class, tenant, employee, first, last, excludeRecord);
        int already = punches == null ? 0 : punches;
        if (OvertimeRequestService.tableReady(jdbc)) {
            Integer requested = jdbc.queryForObject("""
                    SELECT COALESCE(SUM(minutes),0)::int FROM attendance.overtime_requests
                    WHERE tenant_id=? AND employee_id=? AND status='APPROVED' AND request_date BETWEEN ? AND ?
                      AND id IS DISTINCT FROM CAST(? AS uuid)
                    """, Integer.class, tenant, employee, first, last, excludeRequest);
            already += requested == null ? 0 : requested;
        }
        if (already + counted > cap) {
            throw new BusinessRuleException(
                    "This would take them past the monthly overtime cap of %s (%s already approved in %s)".formatted(
                            hm(cap), hm(already), day.getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH)),
                    "OVERTIME_MONTHLY_CAP_REACHED");
        }
    }

    /** 150 → "2h 30m", 120 → "2h", 45 → "45m". */
    static String hm(int minutes) {
        int h = minutes / 60, m = minutes % 60;
        return h > 0 && m > 0 ? h + "h " + m + "m" : h > 0 ? h + "h" : m + "m";
    }
}
