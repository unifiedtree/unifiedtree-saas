package com.hrms.api.workforce;

import com.unifiedtree.notifications.events.RetirementDueEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Retirement due: who reaches their company's retirement age soon, and the
 * alerts that tell HR about it.
 *
 * <p>The retirement date is the day a person reaches the retirement age set for
 * their company in HR Configuration ({@code settings.hr_configuration.retirement_age},
 * 60 when the company has no row or an unusable value), counted from their date
 * of birth. People without a date of birth, and people who have already left,
 * are not listed.
 *
 * <p>Alerts: the daily {@link RetirementAlertJob} notifies everyone holding
 * {@code hrms.retirement.alerts} 90 days before the date and again 30 days
 * before it. Each alert is sent at most once per person and retirement date,
 * claimed through {@code notif.milestone_reminder_log} (unique on tenant,
 * employee, kind, date), so running the job twice, or on two instances, never
 * sends it twice. If a day is missed, the next run still sends it (the job
 * looks at the whole window, not one exact day).
 */
@Service
public class RetirementService {

    private static final Logger log = LoggerFactory.getLogger(RetirementService.class);

    /** Used when a company's HR Configuration has no usable retirement age. */
    static final int DEFAULT_RETIREMENT_AGE = 60;
    /** First alert: this many days (or fewer) before the date. */
    static final int FIRST_ALERT_DAYS = 90;
    /** Second alert: this many days (or fewer) before the date. */
    static final int SECOND_ALERT_DAYS = 30;
    static final String KIND_FIRST = "RETIREMENT_90";
    static final String KIND_SECOND = "RETIREMENT_30";
    /** Cap on recipients per alert, so a large HR team doesn't turn one retirement into a flood. */
    static final int MAX_RECIPIENTS = 25;
    static final String ALERT_PERMISSION = "hrms.retirement.alerts";

    /** The age, in SQL: the company's setting when it is a plausible age, else the default. */
    private static final String AGE_SQL =
            "(CASE WHEN h.retirement_age BETWEEN 30 AND 100 THEN h.retirement_age ELSE " + DEFAULT_RETIREMENT_AGE + " END)";
    private static final String RETIRES_ON_SQL =
            "(e.date_of_birth + make_interval(years => " + AGE_SQL + "))::date";

    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;

    public RetirementService(JdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    /**
     * One person reaching retirement age.
     *
     * @param retirementDate the day they reach {@code retirementAge}
     * @param daysLeft       days from {@code today} to that date (0 = today)
     */
    public record RetirementDue(UUID employeeId, String employeeCode, String name, String initials,
                                String department, String designation,
                                UUID companyId, String companyName,
                                int retirementAge, LocalDate retirementDate, long daysLeft) {}

    /**
     * People whose retirement date falls between {@code today} and
     * {@code today + days} (both included), soonest first. Runs under the
     * caller's tenant (RLS); {@code companyId} null means every company.
     */
    @Transactional(readOnly = true)
    public List<RetirementDue> due(UUID tenantId, LocalDate today, int days, UUID companyId) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder("""
                SELECT e.id, e.employee_code, e.first_name, e.last_name,
                       d.name AS dept, g.title AS designation,
                       e.company_id, c.name AS company,
                       %s AS age, %s AS retires_on
                  FROM hrms.employees e
                  JOIN org.companies c ON c.id = e.company_id
                  LEFT JOIN settings.hr_configuration h ON h.company_id = e.company_id AND h.tenant_id = e.tenant_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id
                 WHERE e.tenant_id = ?
                   AND e.is_active
                   AND e.date_of_birth IS NOT NULL
                   AND e.employment_status NOT IN ('EXITED', 'TERMINATED', 'RESIGNED')
                   AND %s BETWEEN ? AND ?
                """.formatted(AGE_SQL, RETIRES_ON_SQL, RETIRES_ON_SQL));
        args.add(tenantId);
        args.add(today);
        args.add(today.plusDays(Math.max(0, days)));
        if (companyId != null) {
            sql.append(" AND e.company_id = ?");
            args.add(companyId);
        }
        sql.append(" ORDER BY retires_on, e.first_name, e.last_name");
        return jdbc.query(sql.toString(), (rs, i) -> {
            String first = rs.getString("first_name");
            String last = rs.getString("last_name");
            String name = ((first == null ? "" : first) + " " + (last == null ? "" : last)).trim();
            LocalDate on = rs.getDate("retires_on").toLocalDate();
            return new RetirementDue(
                    rs.getObject("id", UUID.class),
                    rs.getString("employee_code"),
                    name.isBlank() ? rs.getString("employee_code") : name,
                    initials(first, last),
                    rs.getString("dept"),
                    rs.getString("designation"),
                    rs.getObject("company_id", UUID.class),
                    rs.getString("company"),
                    rs.getInt("age"),
                    on,
                    ChronoUnit.DAYS.between(today, on));
        }, args.toArray());
    }

    /**
     * Sends the retirement alerts due for one tenant on {@code today}: the
     * 90-day alert for people 31 to 90 days away, the 30-day alert for people
     * 0 to 30 days away. Each goes once per person and retirement date.
     *
     * @return how many people an alert went out for
     */
    @Transactional
    public int alertForTenant(UUID tenantId, LocalDate today) {
        // Scheduler thread: bind the tenant on this connection, or every RLS
        // table below quietly returns nothing.
        bindTenant(tenantId);
        List<RetirementDue> due = due(tenantId, today, FIRST_ALERT_DAYS, null);
        if (due.isEmpty()) return 0;
        List<UUID> holders = alertRecipients(tenantId);
        int sent = 0;
        for (RetirementDue r : due) {
            List<UUID> to = recipientsFor(holders, r.employeeId());
            // Nobody to tell yet: don't claim, so the alert still goes out once
            // someone is given the permission.
            if (to.isEmpty()) continue;
            String kind = kindFor(r.daysLeft());
            if (!claim(tenantId, r.employeeId(), kind, r.retirementDate())) continue;
            jdbc.update("UPDATE notif.milestone_reminder_log SET recipients = ? "
                            + "WHERE tenant_id = ? AND employee_id = ? AND kind = ? AND occurred_on = ?",
                    to.size(), tenantId, r.employeeId(), kind, r.retirementDate());
            events.publishEvent(new RetirementDueEvent(tenantId, r.employeeId(), r.name(), r.department(),
                    r.retirementDate(), r.retirementAge(), r.daysLeft(), to));
            sent++;
        }
        if (sent > 0) log.info("Retirement alerts: {} sent for tenant {} on {}", sent, tenantId, today);
        return sent;
    }

    /** Which alert a person {@code daysLeft} days from retirement gets: the 30-day one, else the 90-day one. */
    static String kindFor(long daysLeft) {
        return daysLeft <= SECOND_ALERT_DAYS ? KIND_SECOND : KIND_FIRST;
    }

    /** The permission holders minus the retiring person, capped at {@link #MAX_RECIPIENTS}. */
    static List<UUID> recipientsFor(List<UUID> holders, UUID retiring) {
        return holders.stream().filter(id -> !id.equals(retiring)).distinct().limit(MAX_RECIPIENTS).toList();
    }

    /** Employees whose sign-in holds hrms.retirement.alerts through one of their roles, longest-standing first. */
    private List<UUID> alertRecipients(UUID tenantId) {
        return jdbc.queryForList("""
                SELECT uc.employee_id
                  FROM rbac.user_roles ur
                  JOIN auth.user_credentials uc ON uc.id = ur.user_id
                  JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id
                 WHERE ur.tenant_id = ?
                   AND rp.permission_code = ?
                   AND uc.employee_id IS NOT NULL
                   AND uc.is_active = TRUE
                 GROUP BY uc.employee_id
                 ORDER BY min(uc.created_at)
                """, UUID.class, tenantId, ALERT_PERMISSION);
    }

    /** True only for the caller that inserted the claim row (another run already sent it otherwise). */
    private boolean claim(UUID tenantId, UUID employeeId, String kind, LocalDate retirementDate) {
        return jdbc.update("""
                INSERT INTO notif.milestone_reminder_log (tenant_id, employee_id, kind, occurred_on)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (tenant_id, employee_id, kind, occurred_on) DO NOTHING
                """, tenantId, employeeId, kind, retirementDate) == 1;
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }

    private static String initials(String first, String last) {
        StringBuilder sb = new StringBuilder();
        if (first != null && !first.isBlank()) sb.append(Character.toUpperCase(first.charAt(0)));
        if (last != null && !last.isBlank()) sb.append(Character.toUpperCase(last.charAt(0)));
        return sb.length() == 0 ? "?" : sb.toString();
    }
}
