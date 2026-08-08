package com.hrms.api.workforce;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.AppNotificationService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The "reminders" half of the milestones feature: birthdays and work
 * anniversaries reach people on the day, instead of only showing up for whoever
 * remembers to open the Milestones screen.
 *
 * <p>Two notifications per milestone, deliberately worded differently:
 * <ul>
 *   <li>a greeting to the person whose day it is; and</li>
 *   <li>a heads-up to the people expected to act on it — their reporting
 *       manager plus HR/admin.</li>
 * </ul>
 * Sending only the second is a dashboard, not a reminder; sending only the
 * first means nobody in the team knows.
 *
 * <p><b>At-most-once.</b> Cloud Run runs more than one instance and
 * {@code @Scheduled} fires on all of them, so the send is gated on winning an
 * INSERT into {@code notif.milestone_reminder_log} (unique on tenant, employee,
 * kind, day). Losing that race means another instance already sent it. This also
 * makes the job safe to re-run by hand after a partial failure.
 */
@Service
public class MilestoneReminderService {

    private static final Logger log = LoggerFactory.getLogger(MilestoneReminderService.class);

    /** Deep-link target on tap — the screen that lists everything upcoming. */
    private static final String ROUTE_MILESTONES = "/milestones";

    private static final String KIND_BIRTHDAY = "BIRTHDAY";
    private static final String KIND_ANNIVERSARY = "WORK_ANNIVERSARY";

    // Seeded system role ids (V004, tenant_id NULL) — same constants the
    // notification listener uses for its terminal-approver fallback.
    private static final UUID HR_MANAGER = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID SUPER_ADMIN = UUID.fromString("00000000-0000-0000-0000-000000000001");

    /**
     * Cap on how many colleagues get told about one person's milestone. A
     * 2,000-seat workspace with a large HR team should not turn one birthday
     * into hundreds of pushes; the manager and a handful of HR/admin accounts
     * are the ones who actually act on it.
     */
    private static final int MAX_OBSERVERS = 12;

    private final JdbcTemplate jdbc;
    private final AppNotificationService notifications;

    public MilestoneReminderService(JdbcTemplate jdbc, AppNotificationService notifications) {
        this.jdbc = jdbc;
        this.notifications = notifications;
    }

    /**
     * Sends today's birthday and anniversary reminders for one tenant.
     *
     * @return how many milestones were actually announced (0 when another
     *         instance already handled them, or when nobody has one today)
     */
    @Transactional
    public int remindForTenant(UUID tenantId, LocalDate today) {
        // Belt and braces alongside TenantAwareDataSource: this runs on a
        // scheduler thread, and every table below is FORCE ROW LEVEL SECURITY.
        // Without the GUC on THIS connection each query quietly returns nothing
        // and the job would report a cheerful "0 reminders" forever.
        bindTenant(tenantId);

        int sent = 0;
        sent += announce(tenantId, today, KIND_BIRTHDAY, findBirthdays(today));
        sent += announce(tenantId, today, KIND_ANNIVERSARY, findAnniversaries(today));
        return sent;
    }

    private int announce(UUID tenantId, LocalDate today, String kind, List<Person> people) {
        int sent = 0;
        for (Person p : people) {
            if (!claim(tenantId, p.id(), kind, today)) {
                log.debug("Milestone {} for {} on {} already sent by another instance", kind, p.id(), today);
                continue;
            }
            try {
                Set<UUID> observers = observersFor(tenantId, p);
                greet(tenantId, p, kind);
                for (UUID observer : observers) {
                    inform(tenantId, observer, p, kind);
                }
                jdbc.update("UPDATE notif.milestone_reminder_log SET recipients = ? "
                                + "WHERE tenant_id = ? AND employee_id = ? AND kind = ? AND occurred_on = ?",
                        observers.size() + 1, tenantId, p.id(), kind, today);
                sent++;
            } catch (Exception ex) {
                // The claim row stays, so a retry will not double-send to the
                // people who already got theirs. Losing one person's greeting
                // is better than re-notifying a whole department.
                log.warn("Milestone {} fan-out failed for employee={} tenant={}: {}",
                        kind, p.id(), tenantId, ex.toString());
            }
        }
        return sent;
    }

    /** Greeting to the person themselves. */
    private void greet(UUID tenantId, Person p, String kind) {
        String title;
        String body;
        if (KIND_BIRTHDAY.equals(kind)) {
            title = "Happy birthday, " + firstName(p.name()) + "!";
            body = "Everyone at " + p.orgLabel() + " wishes you a great day.";
        } else {
            title = "Happy work anniversary!";
            body = p.years() == 1
                    ? "One year with us today. Thank you for everything."
                    : p.years() + " years with us today. Thank you for everything.";
        }
        notifications.create(tenantId, p.id(), AppNotificationType.GENERAL, title, body,
                payload(kind, p, true));
    }

    /** Heads-up to a manager / HR / admin. */
    private void inform(UUID tenantId, UUID recipient, Person p, String kind) {
        String title;
        String body;
        if (KIND_BIRTHDAY.equals(kind)) {
            title = "It's " + p.name() + "'s birthday";
            // Plain ASCII on purpose: this string travels through the Expo push
            // payload and out to OEM notification shades, and a stray em-dash
            // is the classic thing that arrives as a replacement glyph.
            body = p.department() == null ? "Today." : "Today, in " + p.department() + ".";
        } else {
            title = p.name() + " completes " + p.years() + (p.years() == 1 ? " year" : " years");
            body = p.department() == null
                    ? "Work anniversary today."
                    : "Work anniversary today, in " + p.department() + ".";
        }
        notifications.create(tenantId, recipient, AppNotificationType.GENERAL, title, body,
                payload(kind, p, false));
    }

    private Map<String, Object> payload(String kind, Person p, boolean self) {
        Map<String, Object> data = new HashMap<>();
        data.put("type", "MILESTONE_" + kind);
        data.put("employeeId", p.id().toString());
        data.put("self", self);
        // Employees who are not managers have no reason to be sent to a
        // workspace-wide list; their own greeting is not a deep link.
        if (!self) data.put("route", ROUTE_MILESTONES);
        return data;
    }

    /**
     * Wins (or loses) the right to send this milestone. Returns true only for
     * the caller that actually inserted the row.
     */
    private boolean claim(UUID tenantId, UUID employeeId, String kind, LocalDate day) {
        return jdbc.update("""
                INSERT INTO notif.milestone_reminder_log (tenant_id, employee_id, kind, occurred_on)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (tenant_id, employee_id, kind, occurred_on) DO NOTHING
                """, tenantId, employeeId, kind, day) == 1;
    }

    private List<Person> findBirthdays(LocalDate today) {
        return jdbc.query("""
                SELECT e.id,
                       TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS name,
                       d.name AS dept,
                       e.reporting_manager_id,
                       0 AS years
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                 WHERE e.is_active
                   AND e.date_of_birth IS NOT NULL
                   AND EXTRACT(MONTH FROM e.date_of_birth) = EXTRACT(MONTH FROM CAST(? AS date))
                   AND EXTRACT(DAY   FROM e.date_of_birth) = EXTRACT(DAY   FROM CAST(? AS date))
                """, MilestoneReminderService::mapPerson, today, today);
    }

    private List<Person> findAnniversaries(LocalDate today) {
        // >= 1 so somebody who joined today is not congratulated on zero years.
        return jdbc.query("""
                SELECT e.id,
                       TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS name,
                       d.name AS dept,
                       e.reporting_manager_id,
                       (EXTRACT(YEAR FROM CAST(? AS date)) - EXTRACT(YEAR FROM e.date_of_joining))::int AS years
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                 WHERE e.is_active
                   AND e.date_of_joining IS NOT NULL
                   AND EXTRACT(MONTH FROM e.date_of_joining) = EXTRACT(MONTH FROM CAST(? AS date))
                   AND EXTRACT(DAY   FROM e.date_of_joining) = EXTRACT(DAY   FROM CAST(? AS date))
                   AND (EXTRACT(YEAR FROM CAST(? AS date)) - EXTRACT(YEAR FROM e.date_of_joining)) >= 1
                """, MilestoneReminderService::mapPerson, today, today, today, today);
    }

    private static Person mapPerson(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        String name = rs.getString("name");
        return new Person(
                rs.getObject("id", UUID.class),
                (name == null || name.isBlank()) ? "A colleague" : name,
                rs.getString("dept"),
                rs.getObject("reporting_manager_id", UUID.class),
                rs.getInt("years"));
    }

    /** Reporting manager first, then HR managers, then admins — deduped, capped. */
    private Set<UUID> observersFor(UUID tenantId, Person p) {
        Set<UUID> ids = new LinkedHashSet<>();
        if (p.managerId() != null) ids.add(p.managerId());
        ids.addAll(employeesWithRole(tenantId, HR_MANAGER));
        ids.addAll(employeesWithRole(tenantId, SUPER_ADMIN));
        // Never tell someone about their own milestone twice — they already got
        // the greeting, which reads very differently from "It's your birthday".
        ids.remove(p.id());
        if (ids.size() <= MAX_OBSERVERS) return ids;
        List<UUID> capped = new ArrayList<>(ids).subList(0, MAX_OBSERVERS);
        log.info("Capping milestone observers for employee={} at {} (had {})",
                p.id(), MAX_OBSERVERS, ids.size());
        return new LinkedHashSet<>(capped);
    }

    private List<UUID> employeesWithRole(UUID tenantId, UUID roleId) {
        return jdbc.queryForList("""
                SELECT uc.employee_id
                  FROM rbac.user_roles ur
                  JOIN auth.user_credentials uc ON uc.id = ur.user_id
                 WHERE ur.tenant_id = ?
                   AND ur.role_id = ?
                   AND uc.employee_id IS NOT NULL
                   AND uc.is_active = TRUE
                 ORDER BY uc.created_at
                """, UUID.class, tenantId, roleId);
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }

    private static String firstName(String full) {
        int space = full.indexOf(' ');
        return space > 0 ? full.substring(0, space) : full;
    }

    /** One person having a milestone today. */
    private record Person(UUID id, String name, String department, UUID managerId, int years) {
        String orgLabel() {
            return department == null || department.isBlank() ? "UnifiedTree" : department;
        }
    }
}
